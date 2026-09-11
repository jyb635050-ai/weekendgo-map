#!/usr/bin/env python3
"""
Build multi-route trail data for the WeekendGo map from OpenStreetMap.

Output  data/trails/<id>.json
  {
    "routes": [
      { "name": {"en","zh"}, "source": "weekendgo|osm-route|osm-named|osm-derived",
        "line": [[lng,lat],...],          # simplified geometry for drawing
        "pts":  [[lng,lat],...],          # ~80 m resampled points (profile / hover)
        "ele":  [m,...],                  # DEM elevation for each pts
        "dist_km": 5.2, "ascent_m": 820,
        "updated": "YYYY-MM"|null,        # newest OSM edit (or GPX date)
        "oldest":  "YYYY-MM"|null,
        "osm": "relation/123"|null }
    ],
    "net": [[[lng,lat],...],...],         # every nearby path, for context
    "built": "YYYY-MM-DD"
  }

Source priority: weekendgo (our own GPX, see import_gpx.py — preserved across rebuilds)
               > osm-route (route=hiking|foot relations through the summit)
               > osm-named (named trail ways without a relation)
               > osm-derived (fallback: longest mapped approach to the summit)

Every route is oriented trailhead -> summit, trimmed at its high point near the peak,
and rejected if it is a fragment or never reaches the upper mountain.

Usage:  python tools/build_trails.py            # all mountains
        python tools/build_trails.py pulag apo  # selected ids
"""
import datetime, heapq, json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MTS = os.path.join(ROOT, "data", "mountains.json")
OUT = os.path.join(ROOT, "data", "trails")
CACHE = os.path.join(ROOT, "tools", ".cache")
UA = {"User-Agent": "WeekendGoMap/1.0 (hiking map; contact via github jyb635050-ai)"}
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

REL_RADIUS, WAY_RADIUS = 6000, 5000      # m
NEAR_SUMMIT_M = 800        # a route must come this close to the peak
SUMMIT_GAP_M = 1500        # the trimmed route's top must be within this of the peak
MIN_KM, MAX_KM = 1.0, 26.0
MAX_ROUTES = 5
OVERLAP_FRAC = 0.5         # drop a candidate if half of it duplicates an accepted route
SAMPLE_M = 80
TRAILY = re.compile(r"\b(trail|traverse|path|route|circuit|loop|trek|daan|landas|ridge)\b", re.I)
NOT_TRAIL = re.compile(r"\b(road|highway|street|avenue|toilet|parking|bridge|drive)\b", re.I)

os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- geometry
def hav(a, b):
    lo1, la1, lo2, la2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def key(p):
    return (round(p[0], 7), round(p[1], 7))


def poly_len(pts):
    return sum(hav(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def split_geom(geom):
    """bbox-clipped Overpass geometry has nulls where it leaves the box: split there"""
    segs, cur = [], []
    for g in geom:
        if g and "lon" in g:
            cur.append((g["lon"], g["lat"]))
        else:
            if len(cur) > 1:
                segs.append(cur)
            cur = []
    if len(cur) > 1:
        segs.append(cur)
    return segs


def dp(pts, eps):
    """iterative Douglas-Peucker (metres)"""
    n = len(pts)
    if n < 3:
        return pts[:]
    keep = [False] * n
    keep[0] = keep[-1] = True
    st = [(0, n - 1)]
    while st:
        a, b = st.pop()
        pa, pb = pts[a], pts[b]
        L = hav(pa, pb)
        dmax, idx = 0.0, -1
        for i in range(a + 1, b):
            p = pts[i]
            if L < 1:
                d = hav(pa, p)
            else:
                d1, d2 = hav(pa, p), hav(pb, p)
                s = (d1 + d2 + L) / 2
                d = 2 * max(s * (s - d1) * (s - d2) * (s - L), 0) ** 0.5 / L
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps and idx > 0:
            keep[idx] = True
            st += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def resample(pts, step):
    """points every `step` metres along the polyline (interpolated)"""
    out = [pts[0]]
    carry = 0.0
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        seg = hav(a, b)
        if seg == 0:
            continue
        t = step - carry
        while t <= seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            t += step
        carry = seg - (t - step)
    if hav(out[-1], pts[-1]) > step * 0.3:
        out.append(pts[-1])
    return out


class Grid:
    """spatial hash of densified accepted routes, for overlap checks"""
    def __init__(self):
        self.cells = {}

    def add(self, pts):
        for p in resample(pts, 20):
            self.cells.setdefault((round(p[0] / 0.0005), round(p[1] / 0.0005)), []).append(p)

    def add_segs(self, segs):
        for s in segs:
            if len(s) > 1:
                self.add(s)

    def near(self, p, r=40):
        cx, cy = round(p[0] / 0.0005), round(p[1] / 0.0005)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in self.cells.get((cx + dx, cy + dy), ()):
                    if hav(p, q) <= r:
                        return True
        return False

    def overlap(self, segs):
        """fraction of the given segments' length lying on accepted routes"""
        s = [p for seg in segs if len(seg) > 1 for p in resample(seg, 60)]
        return sum(1 for p in s if self.near(p)) / max(len(s), 1)


# ---------------------------------------------------------------- network io
def http_json(url, data=None, timeout=160):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def overpass(q, cache_name, max_age_days=14):
    cf = os.path.join(CACHE, cache_name)
    if os.path.exists(cf) and time.time() - os.path.getmtime(cf) < max_age_days * 86400:
        with open(cf, encoding="utf-8") as f:
            return json.load(f)
    last = None
    for attempt in range(4):
        for srv in SERVERS:
            try:
                els = http_json(srv, urllib.parse.urlencode({"data": q}).encode()).get("elements", [])
                with open(cf, "w", encoding="utf-8") as f:
                    json.dump(els, f)
                return els
            except Exception as e:
                last = e
                time.sleep(8)
        time.sleep(25 * (attempt + 1))
    raise RuntimeError(f"overpass failed: {last}")


# Elevation: decoded locally from the same AWS Terrarium DEM tiles the 3D map renders
# (elevation = R*256 + G + B/256 - 32768). No API rate limits, cached on disk,
# ~19 m pixels at z13, and profiles agree with the terrain users see.
DEM_Z = 13
DEM_DIR = os.path.join(CACHE, "dem")
os.makedirs(DEM_DIR, exist_ok=True)
_DEM = {}


def _dem_tile(tx, ty):
    k = (tx, ty)
    if k not in _DEM:
        from PIL import Image
        fn = os.path.join(DEM_DIR, f"{DEM_Z}_{tx}_{ty}.png")
        if not os.path.exists(fn):
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{tx}/{ty}.png"
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                        data = r.read()
                    with open(fn, "wb") as f:
                        f.write(data)
                    break
                except Exception:
                    time.sleep(3 * (attempt + 1))
            else:
                raise RuntimeError(f"DEM tile {DEM_Z}/{tx}/{ty} failed")
        im = Image.open(fn).convert("RGB")
        _DEM[k] = (im, im.load())
    return _DEM[k][1]


def _dem_px(gx, gy):
    acc = _dem_tile(gx // 256, gy // 256)
    r, g, b = acc[gx % 256, gy % 256]
    return r * 256 + g + b / 256 - 32768


def elevations(pts):
    n = 256 * 2 ** DEM_Z
    out = []
    for lng, lat in pts:
        px = (lng + 180) / 360 * n - 0.5
        py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - 0.5
        x0, y0 = int(math.floor(px)), int(math.floor(py))
        fx, fy = px - x0, py - y0
        v = (_dem_px(x0, y0) * (1 - fx) * (1 - fy) + _dem_px(x0 + 1, y0) * fx * (1 - fy) +
             _dem_px(x0, y0 + 1) * (1 - fx) * fy + _dem_px(x0 + 1, y0 + 1) * fx * fy)
        out.append(max(0, round(v)))          # bilinear; clamp bathymetry at the shore
    return out


# ---------------------------------------------------------------- routing
def graph(ways):
    """ways: [(way_id, [(lng,lat),...])] -> adjacency + edge->way map"""
    adj, ew = {}, {}
    for wid, g in ways:
        for i in range(len(g) - 1):
            a, b = key(g[i]), key(g[i + 1])
            if a == b:
                continue
            d = hav(a, b)
            if d < adj.setdefault(a, {}).get(b, 1e18):
                adj[a][b] = d
                adj.setdefault(b, {})[a] = d
                ew[(a, b)] = ew[(b, a)] = wid
    return adj, ew


def components(adj):
    comp, cid = {}, 0
    for n in adj:
        if n in comp:
            continue
        comp[n], st = cid, [n]
        while st:
            u = st.pop()
            for v in adj[u]:
                if v not in comp:
                    comp[v] = cid
                    st.append(v)
        cid += 1
    return comp


def snap_node(adj, peak, reach, want=None):
    """
    Summit node: the nearest node within `reach` that sits in a useful connected part of
    the network — the component containing `want` nodes (a named route), else the biggest
    component near the peak. Avoids snapping onto an isolated scrap of path at the top.
    """
    near = sorted((hav(n, peak), n) for n in adj)
    near = [(d, n) for d, n in near if d <= reach]
    if not near:
        best = min(adj, key=lambda n: hav(n, peak))
        return None, hav(best, peak)
    comp = components(adj)
    if want:
        ok = {comp[k] for k in want if k in comp}
        for d, n in near:
            if comp[n] in ok:
                return n, d
        return None, near[0][0]
    size = {}
    for c in comp.values():
        size[c] = size.get(c, 0) + 1
    big = max({comp[n] for _, n in near}, key=lambda c: size[c])
    d, n = next((d, n) for d, n in near if comp[n] == big)
    return n, d


def approach(adj, peak, reach=None, max_km=MAX_KM):
    """longest trailhead->summit path in a graph; returns (nodes, snap_m) or (None, snap)"""
    if not adj:
        return None, None
    s, snap = snap_node(adj, peak, reach or NEAR_SUMMIT_M)
    if s is None:
        return None, snap
    dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e18):
            continue
        for v, w in adj[u].items():
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    ends = [n for n in dist if len(adj[n]) == 1 and dist[n] <= max_km * 1000] or \
           [n for n in dist if dist[n] <= max_km * 1000]
    end = max(ends, key=lambda n: dist[n])
    path, n = [], end
    while n != s:
        path.append(n)
        n = prev[n]
    path.append(s)
    return path, snap


def anchored(all_ways, cand_ways, peak, reach=None):
    """
    Route from the summit to the far end of a named trail, allowed to borrow other
    mapped paths (many OSM route relations only tag their unique section and share
    the top with the main trail). Candidate edges are preferred (cheaper).
    Returns (path, edge->way, share_of_candidate, snap) or (None, None, 0, snap).
    """
    cand_ids = {wid for wid, _ in cand_ways}
    adj, ew = graph(all_ways + cand_ways)
    if not adj:
        return None, None, 0, None
    cand_nodes = {key(p) for _, g in cand_ways for p in g}
    s, snap = snap_node(adj, peak, reach or NEAR_SUMMIT_M, want=cand_nodes)
    if s is None:
        return None, None, 0, snap
    cost, real, prev, pq = {s: 0.0}, {s: 0.0}, {}, [(0.0, s)]
    while pq:
        c, u = heapq.heappop(pq)
        if c > cost.get(u, 1e18):
            continue
        for v, w in adj[u].items():
            nc = c + (w if ew.get((u, v)) in cand_ids else w * 1.6)
            if nc < cost.get(v, 1e18) and real[u] + w <= MAX_KM * 1000:
                cost[v], real[v], prev[v] = nc, real[u] + w, u
                heapq.heappush(pq, (nc, v))
    ends = [n for n in cand_nodes if n in cost and n != s]
    if not ends:
        return None, None, 0, snap
    e = max(ends, key=lambda n: real[n])
    path, n = [], e
    while n != s:
        path.append(n)
        n = prev[n]
    path.append(s)
    tot = on = 0.0
    for i in range(len(path) - 1):
        d = adj[path[i]][path[i + 1]]
        tot += d
        if ew.get((path[i], path[i + 1])) in cand_ids:
            on += d
    return path, ew, (on / tot if tot else 0), snap


def finish(path, ew, meta, peak, summit_ele, name, source, osm=None, rel_ts=None, gap=None):
    """orient/trim/validate a node path -> route dict or (None, reason)"""
    if not path or len(path) < 2:
        return None, "no path"
    line = dp(path, 5)
    pts = resample(line, SAMPLE_M)
    ele = elevations(pts)
    # the top we care about is the high point NEAR the summit — a traverse may cross a
    # higher neighbouring peak on the way, which must not decide where the route ends
    near = [i for i in range(len(pts)) if hav(pts[i], peak) <= (gap or SUMMIT_GAP_M)]
    if not near:
        closest = min(hav(p, peak) for p in pts)
        return None, f"never reaches summit (closest {closest:.0f} m)"
    imax = max(near, key=lambda i: ele[i])
    # trim at the high point: trailhead -> summit only
    cut = pts[imax]
    pts, ele = pts[:imax + 1], ele[:imax + 1]
    j = min(range(len(line)), key=lambda i: hav(line[i], cut))
    line = line[:j + 1] + ([cut] if hav(line[j], cut) > 1 else [])
    dist_km = round(poly_len(line) / 1000, 1)
    if dist_km < (0.5 if summit_ele < 600 else MIN_KM):          # small hills have short hikes
        return None, f"fragment ({dist_km} km)"
    if summit_ele >= 400 and max(ele) < 0.55 * summit_ele:
        return None, f"stays low (max {max(ele)} m vs summit {summit_ele} m)"
    sm = [sum(ele[max(0, i - 1):i + 2]) / len(ele[max(0, i - 1):i + 2]) for i in range(len(ele))]
    ascent = round(sum(max(sm[i + 1] - sm[i], 0) for i in range(len(sm) - 1)))
    # freshness from the OSM ways actually used
    stamps = set()
    for i in range(len(path) - 1):
        w = ew.get((path[i], path[i + 1]))
        if w is not None and meta.get(w):
            stamps.add(meta[w])
    if not stamps and rel_ts:
        stamps.add(rel_ts)
    return {
        "name": name, "source": source,
        "line": [[round(p[0], 5), round(p[1], 5)] for p in line],
        "pts": [[round(p[0], 5), round(p[1], 5)] for p in pts],
        "ele": ele, "dist_km": dist_km, "ascent_m": ascent,
        "updated": max(stamps) if stamps else None,
        "oldest": min(stamps) if stamps else None,
        "osm": osm,
    }, "ok"


GENERIC_NAMES = {"trail", "path", "route", "traverse", "traverse trail", "hiking trail", "hike",
                 "hiking", "trek", "summit", "main trail", "footpath"}


def side(pt, peak):
    """compass side of the mountain a trailhead is on: ("north side", "北坡")"""
    dx = (pt[0] - peak[0]) * math.cos(math.radians(peak[1]))
    dy = pt[1] - peak[1]
    i = round(math.degrees(math.atan2(dx, dy)) / 45) % 8
    en = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][i]
    zh = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][i]
    return f"{en} side", f"{zh}坡"


def base_pattern(base):
    """regex for a mountain name tolerant of OSM spelling: Madjaas ~ Madja-as ~ Madja'as"""
    letters = re.sub(r"[^A-Za-z]", "", base)
    return r"[-'’ ]?".join(re.escape(c) for c in letters)


def names(raw, mountain_en):
    """OSM route name -> short {en, zh} label shown inside that mountain's own panel"""
    base = re.sub(r"^(Mt\.?|Mount|Bud)\s+", "", re.split(r"[(·]", mountain_en)[0].strip(), flags=re.I)
    # "Mayon Volcano" -> routes are named "Mayon ... Trail"
    short = re.sub(r"\s+(Volcano|Peaks?|Ridge|Mountain|Range)$", "", base, flags=re.I) or base
    bp = base_pattern(short)
    en = raw.strip().strip("-–— ").strip()
    # "... to the summit" / "A to Mount X Trail" / "Old Trail to Mount X North Peak": the
    # destination is implied by the panel, keep the distinguishing trailhead part
    en = re.sub(r"\s+to\s+(the\s+)?(summit|peak)\b.*$", "", en, flags=re.I)
    en = re.sub(r"\s+to\s+(the\s+)?(Mt\.?|Mount)\s+[^,;()]+?(?=\s+(trail|traverse|path)\b|$)", "", en, flags=re.I)
    en = re.sub(rf"\s+to\s+(the\s+)?{bp}(\s+(summit|peak))?$", "", en, flags=re.I)
    en = re.sub(rf"^((Mt\.?|Mount)\s+)?{bp}\s+", "", en, flags=re.I)
    en = re.sub(rf"\s+{bp}\s+(?=trail)", " ", en, flags=re.I)
    en = re.sub(r"^(Mt\.?|Mount)\s+(?=\S)", "", en, flags=re.I)        # "Mount Talomo Trail" -> "Talomo Trail"
    en = re.sub(r"^Trail\s+to\s+(.+)$", r"\1 Trail", en, flags=re.I)   # "Trail to Pula" -> "Pula Trail"
    # "Southface Trail to Hinalong Dagat" -> "Southface to Hinalong Dagat Trail"
    en = re.sub(r"^(.+?)\s+Trail\s+to\s+(.+)$", r"\1 to \2 Trail", en, flags=re.I)
    en = re.sub(r"\s*[-–]\s*(?=trail\b)", " ", en, flags=re.I)        # "Tinoc - Trail" -> "Tinoc Trail"
    en = re.sub(r"\s+", " ", en).strip(" -–—")
    if not en or en.lower() in GENERIC_NAMES or en.lower() in (base.lower(), short.lower()):
        en = f"{base} Trail"
    return {"en": en, "zh": zh_name(en)}


def zh_name(en):
    zh = en
    # New/Old are only translated as a trail pair ("New Trail"); "New Israel" is a place name
    for pat, rep in [(r"^New\s+to\s+Old\s+Trail$", "新线→旧线"), (r"\bNew\s+Trail\b", "新线"),
                     (r"\bOld\s+Trail\b", "旧线"),
                     (r"\bEco\s+Trail\b", "生态步道"), (r"\bCircuit(\s+Trail)?\b", "环线"),
                     (r"\bLoop(\s+Trail)?\b", "环线"), (r"\bTraverse\b", "纵走"),
                     (r"\bRidge\s+Trail\b", "山脊线"), (r"\bSummit\s+Trail\b", "登顶线"),
                     (r"\s+to\s+", " → "), (r"\bTrail\b", "线")]:
        zh = re.sub(pat, rep, zh, flags=re.I)
    zh = re.sub(r"\s*→\s*", "→", zh)                                   # 新 → 旧 -> 新→旧
    zh = re.sub(r"(?<=[一-鿿→])\s+(?=[一-鿿→])", "", zh)  # 旧 线 -> 旧线
    return re.sub(r"\s+", " ", zh).strip()


# ---------------------------------------------------------------- per mountain
def build(m, log):
    lng, lat = m["coords"]
    peak = (lng, lat)
    # hikes whose real destination isn't the summit node (crater rims, lake shores)
    # declare a wider reach in mountains.json: "trail_reach_m": 1300
    reach = m.get("trail_reach_m") or NEAR_SUMMIT_M
    gap = max(SUMMIT_GAP_M, reach + 500)
    d = 0.075
    bbox = f"{lat - d},{lng - d},{lat + d},{lng + d}"
    q = f"""[out:json][timeout:180];
relation["route"~"^(hiking|foot)$"](around:{REL_RADIUS},{lat},{lng});
out meta geom({bbox});
way["highway"~"^(path|footway|track|steps|bridleway)$"](around:{WAY_RADIUS},{lat},{lng});
out meta geom;"""
    els = overpass(q, f"{m['id']}.json")
    rels = [e for e in els if e["type"] == "relation"]
    ways = [e for e in els if e["type"] == "way" and e.get("geometry")]
    meta = {w["id"]: (w.get("timestamp") or "")[:7] or None for w in ways}

    # keep our own GPX routes from the previous build
    accepted, grid = [], Grid()
    path_file = os.path.join(OUT, m["id"] + ".json")
    if os.path.exists(path_file):
        try:
            old = json.load(open(path_file, encoding="utf-8"))
            for r in old.get("routes", []):
                if r.get("source") == "weekendgo":
                    accepted.append(r)
                    grid.add(r["line"])
        except Exception:
            pass

    pool = []      # (score, route, own_segments) — chosen greedily after all are built
    # the route named after our curated jump-off is the "main" (most-used) route
    GENERIC = {"brgy", "barangay", "sitio", "station", "ranger", "city", "trail", "town", "proper",
               "center", "centre", "hall", "national", "park", "road", "highway", "jump", "municipal",
               "poblacion", "exit", "market", "resort", "falls", "village", "from", "boat", "near"}
    words = lambda s: {w.lower() for w in re.findall(r"[A-Za-z]{4,}", s or "")}
    # ignore the mountain's own name and the province (they'd match every route)
    jtok = words((m.get("jumpoff") or {}).get("en")) - GENERIC - words(m["name"]["en"]) \
        - words(((m.get("province") or {}).get("en") or "").split(",")[-1])

    def consider(route, why, own=None, score=0.0):
        if route is None:
            log.append(f"    - {why}")
            return
        is_main = any(t in route["name"]["en"].lower() for t in jtok)
        is_rel = route["source"] == "osm-route"
        pool.append(((is_main, is_rel, score), route, own or [route["line"]]))

    def select():
        items = sorted(pool, key=lambda c: c[0], reverse=True)
        pool.clear()
        main_taken = any(r.get("main") for r in accepted)
        for (is_main, _, _), route, own in items:
            if len(accepted) >= MAX_ROUTES:
                log.append(f"    - {route['name']['en']}: over the {MAX_ROUTES}-route cap")
                continue
            ov = grid.overlap(own)
            if ov >= OVERLAP_FRAC:
                log.append(f"    - {route['name']['en']}: duplicate ({ov:.0%} of its own section already shown)")
                continue
            same = [r for r in accepted if r.get("base_name", r["name"]["en"]) == route["name"]["en"]]
            if same:
                if ov >= 0.15:     # same name and partly the same ground: a re-mapping, not a new route
                    log.append(f"    - {route['name']['en']}: same name as a shown route ({ov:.0%} overlap)")
                    continue
                # genuinely separate branches sharing a name: tell them apart by the side of the
                # mountain their trailhead is on ("north side"), falling back to a number
                for r in same + [route]:
                    if "base_name" not in r:
                        r["base_name"] = r["name"]["en"]
                        en_s, zh_s = side(r["line"][0], peak)
                        r["name"] = {"en": f"{r['name']['en']} ({en_s})", "zh": f"{r['name']['zh']}（{zh_s}）"}
                labels = [r["name"]["en"] for r in same]
                if route["name"]["en"] in labels:
                    route["name"] = {"en": f"{route['base_name']} {len(same) + 1}",
                                     "zh": f"{zh_name(route['base_name'])} {len(same) + 1}"}
            if is_main and not main_taken:
                route["main"] = True
                main_taken = True
            accepted.append(route)
            grid.add_segs(own)
            log.append(f"    + {route['source']:11s} {route['name']['en'][:34]:34s} {route['dist_km']:5.1f} km "
                       f"+{route['ascent_m']:5d} m  upd {route['updated']}" + ("  [MAIN]" if route.get("main") else ""))

    # 1) route relations
    cands = []
    for r in rels:
        t = r.get("tags", {})
        nm = t.get("name") or t.get("name:en") or t.get("ref")
        if not nm:
            continue
        try:
            if float(re.sub(r"[^\d.]", "", t.get("distance", "0")) or 0) > 60:
                continue          # long-distance route (e.g. a 444 km traverse)
        except ValueError:
            pass
        if t.get("network") in ("iwn", "nwn"):
            continue
        rw = [(mb["ref"], seg) for mb in r.get("members", [])
              if mb.get("type") == "way" and mb.get("geometry")
              for seg in split_geom(mb["geometry"])]
        if rw:
            cands.append((nm, r["id"], (r.get("timestamp") or "")[:7] or None, rw))
    cands.sort(key=lambda c: sum(poly_len(g) for _, g in c[3]))
    allw = [(w["id"], [(g["lon"], g["lat"]) for g in w["geometry"]]) for w in ways]

    def try_named(nm, cw, source, osm=None, ts=None):
        path, ew, share, snap = anchored(allw, cw, peak, reach)
        if path is None:
            log.append(f"    - {nm}: no link to summit" + (f" (network {snap:.0f} m away)" if snap else ""))
            return
        if share < 0.35:
            log.append(f"    - {nm}: mostly other trails (own share {share:.0%})")
            return
        ids = {wid for wid, _ in cw}
        own, cur = [], []
        for i in range(len(path) - 1):
            if ew.get((path[i], path[i + 1])) in ids:
                cur = cur or [path[i]]
                cur.append(path[i + 1])
            elif cur:
                own.append(cur)
                cur = []
        if cur:
            own.append(cur)
        own_km = sum(poly_len(s) for s in own) / 1000
        route, why = finish(path, ew, meta, peak, m["elevation_m"], names(nm, m["name"]["en"]), source, osm, ts, gap)
        if route:
            route["osm_name"] = nm           # keep the original so labels can be re-derived later
        consider(route, f"{nm}: {why}", own, own_km * (1.3 if source == "osm-route" else 1.0))

    for nm, rid, ts, rw in cands:
        try_named(nm, rw, "osm-route", f"relation/{rid}", ts)

    # 2) named trail ways without a relation
    groups = {}
    for w in ways:
        nm = w.get("tags", {}).get("name")
        if nm and TRAILY.search(nm) and not NOT_TRAIL.search(nm):
            groups.setdefault(nm, []).append((w["id"], [(g["lon"], g["lat"]) for g in w["geometry"]]))
    for nm, gw in sorted(groups.items(), key=lambda kv: -sum(poly_len(g) for _, g in kv[1])):
        if sum(poly_len(g) for _, g in gw) < 300:
            continue
        try_named(nm, gw, "osm-named")

    select()

    # 3) fallback: derived approach over the whole path network
    if not any(r["source"] != "weekendgo" for r in accepted):
        adj, ew = graph(allw)
        # a derived route has no name to vouch for it: in dense lowland path networks the
        # "farthest endpoint" can be absurd, so cap it by the mountain's size
        e = m["elevation_m"]
        path, snap = approach(adj, peak, reach, max_km=5 if e < 600 else 10 if e < 1500 else 18)
        if path is None:
            log.append(f"    - derived: no network near summit" + (f" ({snap:.0f} m)" if snap else ""))
        else:
            consider(*finish(path, ew, meta, peak, m["elevation_m"],
                             {"en": "Main approach (derived)", "zh": "主要登顶路径（推算）"}, "osm-derived",
                             gap=gap))
            select()

    # context network
    net, total = [], 0
    for w in ways:
        g = dp([(p["lon"], p["lat"]) for p in w["geometry"]], 20)
        if len(g) > 1:
            net.append([[round(p[0], 4), round(p[1], 4)] for p in g])
            total += len(g)
        if total > 3000:
            break
    # display order: our own GPX first, then the main route, then the rest
    accepted.sort(key=lambda r: (r.get("source") != "weekendgo", not r.get("main")))
    return accepted, net


def main(ids):
    mts = json.load(open(MTS, encoding="utf-8"))["mountains"]
    todo = [m for m in mts if not ids or m["id"] in ids]
    report = []
    for n, m in enumerate(todo, 1):
        log = [f"[{n}/{len(todo)}] {m['id']}"]
        try:
            routes, net = build(m, log)
        except Exception as e:
            log.append(f"    ! ERROR {e}")
            print("\n".join(log), flush=True)
            report.append((m["id"], "error"))
            continue
        path_file = os.path.join(OUT, m["id"] + ".json")
        for r in routes:
            r.pop("base_name", None)
        if routes:
            with open(path_file, "w", encoding="utf-8") as f:
                json.dump({"routes": routes, "net": net, "built": datetime.date.today().isoformat()},
                          f, ensure_ascii=False, separators=(",", ":"))
            report.append((m["id"], f"{len(routes)} route(s)"))
        else:
            if os.path.exists(path_file):
                os.remove(path_file)       # old trail failed today's quality bar
                log.append("    ! removed stale trail file (no route passes QA)")
            report.append((m["id"], "none"))
        print("\n".join(log), flush=True)
        time.sleep(6)
    ids_with = sorted(f[:-5] for f in os.listdir(OUT) if f.endswith(".json") and f != "index.json")
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(ids_with, f)
    print(f"\nindex: {len(ids_with)} mountains with trails")
    print("summary:", ", ".join(f"{i}={s}" for i, s in report))


if __name__ == "__main__":
    main(sys.argv[1:])
