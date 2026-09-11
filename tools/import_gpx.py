#!/usr/bin/env python3
"""
Import WeekendGo's own recorded GPS tracks (the freshest trail source).

Drop GPX files (exported from 两步路 / Strava / Gaia / Garmin / Relive ...) into
    tools/gpx-inbox/<mountain-id>/<any-name>.gpx
then run
    python tools/import_gpx.py            # everything in the inbox
    python tools/import_gpx.py pulag      # one mountain

Each track becomes a "那我走实测 / WeekendGo GPS" route: trimmed trailhead -> summit,
DEM elevation (same as the OSM routes, so numbers are comparable), dated from the
GPX timestamps, and shown FIRST on the map. build_trails.py keeps these routes when
it rebuilds the OSM ones. Imported files move to tools/gpx-inbox/_imported/.

The route name comes from the file name (e.g. "Akiki Trail.gpx" -> "Akiki Trail"),
or from the GPX <name> when the file name is generic.
"""
import datetime, json, os, re, shutil, sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trails as bt  # noqa: E402  (shared geometry / elevation helpers)

INBOX = os.path.join(bt.ROOT, "tools", "gpx-inbox")
DONE = os.path.join(INBOX, "_imported")
REACH_M = 600          # the track must pass this close to the summit


def parse_gpx(path):
    root = ET.parse(path).getroot()
    loc = lambda el: el.tag.rsplit("}", 1)[-1]
    pts, times, name = [], [], None
    for el in root.iter():
        tag = loc(el)
        if tag == "name" and name is None and el.text:
            name = el.text.strip()
        if tag in ("trkpt", "rtept"):
            try:
                pts.append((float(el.get("lon")), float(el.get("lat"))))
            except (TypeError, ValueError):
                continue
            for ch in el:
                if loc(ch) == "time" and ch.text:
                    times.append(ch.text.strip())
    # drop consecutive duplicates / sub-metre jitter
    clean = [pts[0]] if pts else []
    for p in pts[1:]:
        if bt.hav(p, clean[-1]) > 2:
            clean.append(p)
    return clean, times, name


def import_one(m, path, log):
    pts, times, gpx_name = parse_gpx(path)
    if len(pts) < 10:
        log.append(f"    ! {os.path.basename(path)}: too few points")
        return None
    peak = tuple(m["coords"])
    i_top = min(range(len(pts)), key=lambda i: bt.hav(pts[i], peak))
    gap = bt.hav(pts[i_top], peak)
    if gap > REACH_M:
        log.append(f"    ! {os.path.basename(path)}: never within {REACH_M} m of the summit (closest {gap:.0f} m) — skipped")
        return None
    ascent_part = pts[:i_top + 1]
    if bt.poly_len(ascent_part) < 500:           # recorded from the top? use the other half
        ascent_part = list(reversed(pts[i_top:]))
    line = bt.dp(ascent_part, 5)
    samp = bt.resample(line, bt.SAMPLE_M)
    ele = bt.elevations(samp)
    sm = [sum(ele[max(0, i - 1):i + 2]) / len(ele[max(0, i - 1):i + 2]) for i in range(len(ele))]
    stem = os.path.splitext(os.path.basename(path))[0]
    generic = re.fullmatch(r"(track|activity|gpx|export|route|\d[\d_\- ]*)", stem, re.I)
    raw = (gpx_name if generic and gpx_name else stem.replace("_", " ")).strip()
    when = (times[0][:7] if times else
            datetime.date.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m"))
    return {
        "name": {"en": raw, "zh": raw}, "source": "weekendgo",
        "line": [[round(p[0], 5), round(p[1], 5)] for p in line],
        "pts": [[round(p[0], 5), round(p[1], 5)] for p in samp],
        "ele": ele, "dist_km": round(bt.poly_len(line) / 1000, 1),
        "ascent_m": round(sum(max(sm[i + 1] - sm[i], 0) for i in range(len(sm) - 1))),
        "updated": when, "oldest": when, "osm": None,
    }


def main(ids):
    if not os.path.isdir(INBOX):
        os.makedirs(INBOX)
        print(f"created {INBOX} — put GPX files in <mountain-id>/ sub-folders and run again")
        return
    mts = {m["id"]: m for m in json.load(open(bt.MTS, encoding="utf-8"))["mountains"]}
    folders = [d for d in os.listdir(INBOX) if os.path.isdir(os.path.join(INBOX, d)) and not d.startswith("_")]
    for mid in folders:
        if ids and mid not in ids:
            continue
        if mid not in mts:
            print(f"! unknown mountain id '{mid}' (folder name must match an id in data/mountains.json)")
            continue
        log = [f"{mid}"]
        files = sorted(f for f in os.listdir(os.path.join(INBOX, mid)) if f.lower().endswith(".gpx"))
        new_routes = []
        for f in files:
            r = import_one(mts[mid], os.path.join(INBOX, mid, f), log)
            if r:
                new_routes.append((f, r))
                log.append(f"    + {r['name']['en']}: {r['dist_km']} km +{r['ascent_m']} m ({r['updated']})")
        if new_routes:
            out = os.path.join(bt.OUT, mid + ".json")
            data = {"routes": [], "net": [], "built": datetime.date.today().isoformat()}
            if os.path.exists(out):
                old = json.load(open(out, encoding="utf-8"))
                if isinstance(old.get("routes"), list):
                    data = old
            names = {r["name"]["en"] for _, r in new_routes}
            data["routes"] = [r for _, r in new_routes] + \
                [r for r in data["routes"] if not (r.get("source") == "weekendgo" and r["name"]["en"] in names)]
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
            os.makedirs(os.path.join(DONE, mid), exist_ok=True)
            for f, _ in new_routes:
                shutil.move(os.path.join(INBOX, mid, f), os.path.join(DONE, mid, f))
        print("\n".join(log))
    ids_with = sorted(f[:-5] for f in os.listdir(bt.OUT) if f.endswith(".json") and f != "index.json")
    with open(os.path.join(bt.OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(ids_with, fh)
    print(f"index: {len(ids_with)} mountains with trails")


if __name__ == "__main__":
    main(sys.argv[1:])
