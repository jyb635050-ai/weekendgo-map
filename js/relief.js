/* ============================================================
   relief.js — printable terrain relief of one mountain + 3MF writer
   Pure geometry (no DOM): the site's 3D-print dialog and the Node
   check tool (tools/build_relief.mjs) share this exact file.

   Units: model space is millimetres, x = east, y = north, z = up,
   centred on the build plate. Terrain comes from a height sampler
   heightAt(eastMetres, northMetres) around the summit.

   Parts (each a closed, outward-wound triangle mesh, one colour):
     terrain — the relief with walls down to a flat bottom; the band
               between z=0 and the lowest ground is the plinth
     label   — the English name, raised on the south (front) wall
     trail   — optional hiking route draped on the surface
   Parts only touch (never interpenetrate), so a single-colour print
   is one solid and an AMS print gets clean colour boundaries.
   ============================================================ */

import { ShapeUtils, Vector2 } from "../vendor/three/three.module.js";
import * as OT from "../vendor/opentype.js";
import { zipSync, strToU8 } from "../vendor/fflate.js";

const opentype = OT.default ?? OT;
export const parseFont = (buf) => opentype.parse(buf instanceof ArrayBuffer ? buf
  : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

export const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/* ---------------------------------------------------------------- geo */
const M_PER_DEG_LAT = 110574;
const mPerDegLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

export function toLocal(lng, lat, lng0, lat0) {
  return [(lng - lng0) * mPerDegLng(lat0), (lat - lat0) * M_PER_DEG_LAT];
}
export function toLngLat(x, y, lng0, lat0) {
  return [lng0 + x / mPerDegLng(lat0), lat0 + y / M_PER_DEG_LAT];
}

const worldPx = (lng, lat, z) => {
  const n = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

/** which Terrarium tiles cover a square of half-width halfM around (lng0,lat0), at a zoom
 *  whose pixels are about as fine as the mesh cells */
export function planTiles(lng0, lat0, halfM, cellM) {
  const mpp0 = 156543.03 * Math.cos(lat0 * Math.PI / 180);          // metres per pixel at z0
  let z = Math.ceil(Math.log2(mpp0 / Math.max(8, cellM * 0.8)));
  z = Math.max(9, Math.min(14, z));
  const pad = halfM * 1.05;
  const [w, s] = toLngLat(-pad, -pad, lng0, lat0), [e, n] = toLngLat(pad, pad, lng0, lat0);
  for (;;) {
    const a = worldPx(w, n, z), b = worldPx(e, s, z);
    const x0 = Math.floor(a[0] / 256), x1 = Math.floor(b[0] / 256);
    const y0 = Math.floor(a[1] / 256), y1 = Math.floor(b[1] / 256);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 36 || z <= 9) {
      const tiles = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
      return { z, tiles };
    }
    z--;
  }
}

/** bilinear Terrarium sampler. tiles: Map "x/y" -> {data (RGB or RGBA bytes), ch, size} */
export function demSampler(z, tiles, lng0, lat0) {
  const cache = new Map();
  const elevPx = (px, py) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const k = tx + "/" + ty;
    let t = cache.get(k);
    if (t === undefined) { t = tiles.get(k) || null; cache.set(k, t); }
    if (!t) return 0;
    const ix = Math.min(255, Math.max(0, Math.floor(px - tx * 256)));
    const iy = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
    const o = (iy * 256 + ix) * t.ch;
    return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
  };
  return (x, y) => {
    const [lng, lat] = toLngLat(x, y, lng0, lat0);
    const [px, py] = worldPx(lng, lat, z);
    const fx = px - 0.5, fy = py - 0.5;                                  // pixel centres
    const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const h = elevPx(x0, y0) * (1 - dx) * (1 - dy) + elevPx(x0 + 1, y0) * dx * (1 - dy)
      + elevPx(x0, y0 + 1) * (1 - dx) * dy + elevPx(x0 + 1, y0 + 1) * dx * dy;
    return Math.max(0, h);                                              // sea = flat base
  };
}

/** sensible default half-width (m): bigger mountains get more context */
export function defaultHalfM(elevation) {
  const e = elevation || 1000;
  return e < 700 ? 2000 : e < 1300 ? 2800 : e < 2000 ? 3500 : 4500;
}

/* ---------------------------------------------------------------- mesh helpers */
class MeshBuf {
  constructor() { this.v = []; this.t = []; }
  add(x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; }
  tri(a, b, c) { this.t.push(a, b, c); }
  /* add a triangle wound so its normal points along `out` */
  face(a, b, c, out) {
    const v = this.v;
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) this.t.push(a, c, b); else this.t.push(a, b, c);
  }
  quad(a, b, c, d, out) { this.face(a, b, c, out); this.face(a, c, d, out); }
  part(name, color, extruder, offset) {
    const vp = new Float32Array(this.v);
    for (let i = 0; i < vp.length; i += 3) { vp[i] += offset[0]; vp[i + 1] += offset[1]; }
    return { name, color, extruder, numVert: vp.length / 3, numProp: 3, vertProperties: vp,
      triVerts: Uint32Array.from(this.t) };
  }
}

/* ---------------------------------------------------------------- terrain body */
function terrainSquare(zAt, S, cell) {
  const N = Math.max(8, Math.round(S / cell)), h = S / 2, st = S / N;
  const mb = new MeshBuf();
  const top = new Int32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = -h + i * st, y = -h + j * st;
    top[j * (N + 1) + i] = mb.add(x, y, zAt(x, y));
  }
  const T = (i, j) => top[j * (N + 1) + i];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // split each cell along the diagonal that follows the terrain better
    const a = T(i, j), b = T(i + 1, j), c = T(i + 1, j + 1), d = T(i, j + 1);
    const za = mb.v[a * 3 + 2], zb = mb.v[b * 3 + 2], zc = mb.v[c * 3 + 2], zd = mb.v[d * 3 + 2];
    if (Math.abs(za - zc) <= Math.abs(zb - zd)) { mb.tri(a, b, c); mb.tri(a, c, d); }
    else { mb.tri(a, b, d); mb.tri(b, c, d); }
  }
  // boundary loop, counter-clockwise from above
  const loop = [];
  for (let i = 0; i < N; i++) loop.push(T(i, 0));
  for (let j = 0; j < N; j++) loop.push(T(N, j));
  for (let i = N; i > 0; i--) loop.push(T(i, N));
  for (let j = N; j > 0; j--) loop.push(T(0, j));
  closeBottom(mb, loop);
  return mb;
}

function terrainRound(zAt, R, cell) {
  const K = Math.max(6, Math.round(R / cell));
  const M = Math.max(64, Math.round(2 * Math.PI * R / cell / 4) * 4);
  const mb = new MeshBuf();
  const c = mb.add(0, 0, zAt(0, 0));
  const rings = [];
  for (let k = 1; k <= K; k++) {
    const r = R * k / K, ring = new Int32Array(M);
    for (let j = 0; j < M; j++) {
      const a = 2 * Math.PI * j / M, x = r * Math.cos(a), y = r * Math.sin(a);
      ring[j] = mb.add(x, y, zAt(x, y));
    }
    rings.push(ring);
  }
  for (let j = 0; j < M; j++) mb.tri(c, rings[0][j], rings[0][(j + 1) % M]);
  for (let k = 0; k < K - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      mb.tri(A[j], B[j], B[j1]); mb.tri(A[j], B[j1], A[j1]);
    }
  }
  closeBottom(mb, Array.from(rings[K - 1]));
  return mb;
}

/* walls from a CCW top boundary loop straight down to z=0, then a flat bottom (fan) */
function closeBottom(mb, loop) {
  const n = loop.length, bot = new Int32Array(n);
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const v = loop[i] * 3;
    bot[i] = mb.add(mb.v[v], mb.v[v + 1], 0);
    cx += mb.v[v]; cy += mb.v[v + 1];
  }
  const c = mb.add(cx / n, cy / n, 0);
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n, a = loop[i] * 3, b = loop[i1] * 3;
    const ex = mb.v[b] - mb.v[a], ey = mb.v[b + 1] - mb.v[a + 1];
    const out = [ey, -ex, 0];                                   // right of a CCW edge = outside
    mb.quad(bot[i], bot[i1], loop[i1], loop[i], out);
    mb.face(c, bot[i1], bot[i], [0, 0, -1]);
  }
}

/* ---------------------------------------------------------------- label text */
function glyphRings(font, text, size, steps = 10) {
  // one group of rings per glyph, y flipped to point up
  const glyphs = [];
  for (const path of font.getPaths(text, 0, 0, size)) {
    const rings = [];
    let cur = null, cx = 0, cy = 0;
    const close = () => {
      if (cur && cur.length > 2) {
        const a = cur[0], b = cur[cur.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) cur.pop();
        if (cur.length > 2) rings.push(cur);
      }
      cur = null;
    };
    for (const c of path.commands) {
      if (c.type === "M") { close(); cur = [[c.x, -c.y]]; cx = c.x; cy = c.y; }
      else if (c.type === "L") { cur.push([c.x, -c.y]); cx = c.x; cy = c.y; }
      else if (c.type === "Q") {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([u * u * cx + 2 * u * t * c.x1 + t * t * c.x, -(u * u * cy + 2 * u * t * c.y1 + t * t * c.y)]);
        }
        cx = c.x; cy = c.y;
      } else if (c.type === "C") {
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            -(u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y)]);
        }
        cx = c.x; cy = c.y;
      } else if (c.type === "Z") close();
    }
    close();
    // drop consecutive duplicate points (earcut and wall quads dislike them)
    const clean = rings.map((r) => r.filter((p, i) => {
      const q = r[(i + r.length - 1) % r.length];
      return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
    })).filter((r) => r.length > 2);
    if (clean.length) glyphs.push(clean);
  }
  return glyphs;
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
const inRing = (p, r) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins;
  }
  return ins;
};

/* outer rings with their holes, by nesting depth (font-winding agnostic) */
function shapesOf(rings) {
  const depth = rings.map((r, i) => rings.reduce((d, o, j) => d + (j !== i && inRing(r[0], o) ? 1 : 0), 0));
  const shapes = [];
  rings.forEach((r, i) => {
    if (depth[i] % 2) return;
    const outer = ringArea(r) > 0 ? r : r.slice().reverse();          // CCW
    const holes = rings.filter((h, j) => depth[j] === depth[i] + 1 && inRing(h[0], r))
      .map((h) => (ringArea(h) < 0 ? h : h.slice().reverse()));      // CW
    shapes.push({ outer, holes });
  });
  return shapes;
}

/* extrude label shapes (u right, v up, w out of the wall) and map them onto the wall */
function labelMesh(shapes, depth, map) {
  const mb = new MeshBuf();
  for (const { outer, holes } of shapes) {
    const rings = [outer, ...holes];
    const flat = rings.flat();
    const back = flat.map((p) => mb.add(...map(p[0], p[1], 0)));
    const front = flat.map((p) => mb.add(...map(p[0], p[1], depth)));
    const tris = ShapeUtils.triangulateShape(outer.map((p) => new Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))));
    for (let [a, b, c] of tris) {
      const pa = flat[a], pb = flat[b], pc = flat[c];
      if ((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0) [b, c] = [c, b];
      mb.tri(front[a], front[b], front[c]);                          // CCW in uv -> faces +w
      mb.tri(back[a], back[c], back[b]);
    }
    let o = 0;
    for (const r of rings) {                                         // outer CCW, holes CW
      for (let i = 0; i < r.length; i++) {
        const a = o + i, b = o + (i + 1) % r.length;
        mb.tri(back[a], back[b], front[b]); mb.tri(back[a], front[b], front[a]);
      }
      o += r.length;
    }
  }
  return mb;
}

/* ---------------------------------------------------------------- trail ribbon */
function ribbonMesh(paths, zAt, width, height, sink) {
  const mb = new MeshBuf();
  for (const P of paths) {
    const n = P.length;
    if (n < 2) continue;
    const L = [], Rr = [], Lt = [], Rt = [];
    const dirs = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy) || 1;
      dirs.push([dx / l, dy / l]);
    }
    for (let i = 0; i < n; i++) {
      const d0 = dirs[Math.max(0, i - 1)], d1 = dirs[Math.min(n - 2, i)];
      let nx = -(d0[1] + d1[1]), ny = d0[0] + d1[0];
      let l = Math.hypot(nx, ny);
      if (l < 1e-6) { nx = -d1[1]; ny = d1[0]; l = 1; }
      nx /= l; ny /= l;
      const miter = Math.min(2, 1 / Math.max(0.5, nx * -d1[1] + ny * d1[0]));
      const hw = width / 2 * miter, [x, y] = P[i], z = zAt(x, y);
      L.push(mb.add(x + nx * hw, y + ny * hw, z - sink));
      Rr.push(mb.add(x - nx * hw, y - ny * hw, z - sink));
      Lt.push(mb.add(x + nx * hw, y + ny * hw, z + height));
      Rt.push(mb.add(x - nx * hw, y - ny * hw, z + height));
    }
    // winding fixed by topology (not by geometry) so tight switchbacks that fold the
    // ribbon onto itself still give a closed, consistently wound shell
    for (let i = 0; i < n - 1; i++) {
      mb.tri(Lt[i], Rt[i], Rt[i + 1]); mb.tri(Lt[i], Rt[i + 1], Lt[i + 1]);       // top
      mb.tri(L[i], Rr[i + 1], Rr[i]); mb.tri(L[i], L[i + 1], Rr[i + 1]);          // bottom
      mb.tri(L[i], Lt[i + 1], L[i + 1]); mb.tri(L[i], Lt[i], Lt[i + 1]);          // left wall
      mb.tri(Rr[i], Rr[i + 1], Rt[i + 1]); mb.tri(Rr[i], Rt[i + 1], Rt[i]);       // right wall
    }
    mb.tri(L[0], Rr[0], Rt[0]); mb.tri(L[0], Rt[0], Lt[0]);                       // start cap
    const e = n - 1;
    mb.tri(L[e], Rt[e], Rr[e]); mb.tri(L[e], Lt[e], Rt[e]);                       // end cap
  }
  return mb;
}

/* clip a model-space polyline to the footprint and resample it evenly */
function clipResample(line, inside, step) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = i ? 1 : 0; s <= k; s++) {
      const p = [a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k];
      if (inside(p[0], p[1])) cur.push(p); else flush();
    }
  }
  flush();
  // thin to ~step spacing and drop crumbs shorter than 3 mm
  return out.map((pl) => {
    const r = [pl[0]];
    for (const p of pl) if (Math.hypot(p[0] - r[r.length - 1][0], p[1] - r[r.length - 1][1]) >= step) r.push(p);
    const last = pl[pl.length - 1], prev = r[r.length - 1];
    if (prev !== last) {
      if (r.length > 1 && Math.hypot(last[0] - prev[0], last[1] - prev[1]) < step / 2) r[r.length - 1] = last;
      else r.push(last);
    }
    return r;
  }).filter((pl) => pl.length > 2 && pl.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - pl[i - 1][0], p[1] - pl[i - 1][1]) : 0), 0) > 3);
}

/* ---------------------------------------------------------------- the model */
/**
 * opts: {
 *   heightAt(xm, ym) -> metres,   halfM: ground half-width (m),
 *   shape: "round"|"square", sizeMM: diameter / side, exag: vertical exaggeration,
 *   baseMM: plinth height under the lowest ground, cellMM: mesh resolution,
 *   label: string, font: opentype Font,
 *   trails: [[[xm, ym], ...], ...] local metres,
 *   colors: {terrain, label, trail}, center: [x, y] on the plate (mm)
 * }
 */
export function buildRelief(o) {
  const shape = o.shape === "square" ? "square" : "round";
  const size = o.sizeMM || 120, half = size / 2;
  const s = half / o.halfM;                                        // mm per metre (horizontal)
  const exag = o.exag || 1.5, base = o.baseMM || 10, cell = o.cellMM || 0.5;
  const center = o.center || [128, 128];
  const colors = { terrain: "#7E8F6A", label: "#F5F5F0", trail: "#F97316", ...(o.colors || {}) };

  // sample ground once on a fine grid shared by both shapes, then interpolate
  const G = Math.max(64, Math.ceil(size / cell) + 1), gs = size / (G - 1);
  const H = new Float32Array(G * G);
  let hmin = Infinity, hmax = -Infinity;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -half + i * gs, y = -half + j * gs;
    const h = o.heightAt(x / s, y / s);
    H[j * G + i] = h;
    if (shape === "square" || x * x + y * y <= half * half * 1.0001) {
      if (h < hmin) hmin = h;
      if (h > hmax) hmax = h;
    }
  }
  const zs = s * exag;
  const hAt = (x, y) => {
    const fx = Math.min(G - 1.000001, Math.max(0, (x + half) / gs));
    const fy = Math.min(G - 1.000001, Math.max(0, (y + half) / gs));
    const i = Math.floor(fx), j = Math.floor(fy), dx = fx - i, dy = fy - j;
    return H[j * G + i] * (1 - dx) * (1 - dy) + H[j * G + i + 1] * dx * (1 - dy)
      + H[(j + 1) * G + i] * (1 - dx) * dy + H[(j + 1) * G + i + 1] * dx * dy;
  };
  const zAt = (x, y) => base + Math.max(0, hAt(x, y) - hmin) * zs;

  const parts = [];
  const body = shape === "square" ? terrainSquare(zAt, size, cell) : terrainRound(zAt, half, cell);
  parts.push(body.part("Terrain", colors.terrain, 1, center));

  // ---- label on the south wall
  const warnings = [];
  const text = (o.label || "").trim();
  let labelInfo = null;
  if (text && o.font) {
    const font = o.font;
    const capRatio = ((font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7) / font.unitsPerEm;
    const band = base;                                             // wall height free of terrain
    let cap = Math.min(7, Math.max(3, band * 0.55));
    const maxW = shape === "square" ? size * 0.86 : Math.min(size * 0.86, half * 1.75);
    let fs = cap / capRatio;
    const w = font.getAdvanceWidth(text, fs);
    if (w > maxW) { fs *= maxW / w; cap = fs * capRatio; }
    if (cap < 2.6) warnings.push("label-small");
    const tw = font.getAdvanceWidth(text, fs);
    const glyphs = glyphRings(font, text, fs);
    const baseline = (band - cap) / 2;
    const shapes = [];
    for (const g of glyphs) for (const sh of shapesOf(g)) {
      const mv = (p) => [p[0] - tw / 2, p[1] + baseline];
      shapes.push({ outer: sh.outer.map(mv), holes: sh.holes.map((h) => h.map(mv)) });
    }
    const depth = 0.8;
    const map = shape === "square"
      ? (u, v, w) => [u, -half - w, v]
      : (u, v, w) => {
        const a = -Math.PI / 2 + u / half, r = half + w;
        return [r * Math.cos(a), r * Math.sin(a), v];
      };
    const lm = labelMesh(shapes, depth, map);
    if (lm.t.length) parts.push(lm.part("Label", colors.label, 2, center));
    labelInfo = { capMM: +cap.toFixed(1), widthMM: +tw.toFixed(1) };
  }

  // ---- trail ribbons
  if (o.trails && o.trails.length) {
    const margin = 1.5;
    const inside = shape === "square"
      ? (x, y) => Math.abs(x) < half - margin && Math.abs(y) < half - margin
      : (x, y) => x * x + y * y < (half - margin) ** 2;
    const paths = [];
    for (const line of o.trails) {
      const mm = line.map(([x, y]) => [x * s, y * s]);
      paths.push(...clipResample(mm, inside, Math.max(0.4, cell)));
    }
    const rb = ribbonMesh(paths, zAt, o.trailWidthMM || 1.2, 0.8, 0.3);
    if (rb.t.length) parts.push(rb.part("Trail", colors.trail, 3, center));
  }

  const top = base + (hmax - hmin) * zs + (o.trails && o.trails.length ? 0.8 : 0);
  return {
    parts,
    warnings,
    stats: {
      shape, sizeMM: size, heightMM: +top.toFixed(1), exag, baseMM: base,
      scale: Math.round(1000 / s),                                  // 1 : n
      groundKm: +(o.halfM * 2 / 1000).toFixed(1),
      hmin: Math.round(hmin), hmax: Math.round(hmax),
      tris: parts.reduce((n, p) => n + p.triVerts.length / 3, 0),
      label: labelInfo,
    },
  };
}

/* ---------------------------------------------------------------- 3MF
   One printable object built from parts (3MF core <components>), each part carrying its
   own colour + extruder in Metadata/model_settings.config. Separate top-level objects would
   NOT work here: slicers drop every object onto the bed on its own, so the label and the
   trail (which float on the terrain's walls/surface) would fall off the model. */
const x3 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex8 = (c) => {
  let h = String(c || "#CCCCCC").trim();
  if (h[0] !== "#") h = "#" + h;
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return (h.length === 7 ? h + "FF" : h).toUpperCase();
};

export function build3MF(parts, meta = {}) {
  const use = parts.filter((p) => p && p.triVerts.length >= 3);
  if (!use.length) throw new Error("empty model");
  const palette = [];
  const pidx = (c) => { const h = hex8(c); let i = palette.indexOf(h); if (i < 0) { palette.push(h); i = palette.length - 1; } return i; };
  const idx = use.map((p) => pidx(p.color));

  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'];
  for (const [k, v] of Object.entries({ Title: meta.title, Designer: meta.designer, Description: meta.description,
    Copyright: meta.copyright, Application: "WeekendGo relief generator" })) {
    if (v) out.push(` <metadata name="${k}">${x3(v)}</metadata>\n`);
  }
  out.push(' <resources>\n  <basematerials id="1">\n');
  palette.forEach((h, i) => out.push(`   <base name="Color${i + 1}" displaycolor="${h}"/>\n`));
  out.push("  </basematerials>\n");
  const asm = use.length + 2;                                      // the assembly object id
  const cfg = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n',
    ` <object id="${asm}">\n  <metadata key="name" value="${x3(meta.title || "Relief")}"/>\n  <metadata key="extruder" value="1"/>\n`];
  const comps = [];
  use.forEach((p, n) => {
    const id = n + 2, vp = p.vertProperties, tv = p.triVerts;
    out.push(`  <object id="${id}" name="${x3(p.name)}" type="model" pid="1" pindex="${idx[n]}">\n   <mesh>\n    <vertices>\n`);
    const chunk = [];
    for (let i = 0; i < p.numVert; i++) {
      const q = i * 3;
      chunk.push(`     <vertex x="${vp[q].toFixed(3)}" y="${vp[q + 1].toFixed(3)}" z="${vp[q + 2].toFixed(3)}"/>\n`);
      if (chunk.length > 4096) { out.push(chunk.join("")); chunk.length = 0; }
    }
    out.push(chunk.join(""), "    </vertices>\n    <triangles>\n");
    chunk.length = 0;
    for (let i = 0; i < tv.length; i += 3) {
      chunk.push(`     <triangle v1="${tv[i]}" v2="${tv[i + 1]}" v3="${tv[i + 2]}"/>\n`);
      if (chunk.length > 4096) { out.push(chunk.join("")); chunk.length = 0; }
    }
    out.push(chunk.join(""), "    </triangles>\n   </mesh>\n  </object>\n");
    cfg.push(`  <part id="${id}" subtype="normal_part">\n   <metadata key="name" value="${x3(p.name)}"/>\n   <metadata key="extruder" value="${p.extruder || 1}"/>\n  </part>\n`);
    comps.push(`   <component objectid="${id}"/>\n`);
  });
  out.push(`  <object id="${asm}" name="${x3(meta.title || "Relief")}" type="model">\n   <components>\n`, comps.join(""),
    "   </components>\n  </object>\n");
  out.push(" </resources>\n", ` <build>\n  <item objectid="${asm}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n </build>\n</model>\n`);
  cfg.push(" </object>\n</config>\n");

  const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    "[Content_Types].xml": strToU8(types),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(out.join("")),
    "Metadata/model_settings.config": strToU8(cfg.join("")),
  }, { level: 6 });
}

/* ---------------------------------------------------------------- mesh QA
   every edge must be used exactly twice, once in each direction (closed + consistently wound),
   and the enclosed volume must be positive (normals point out) */
export function checkMesh(p) {
  const tv = p.triVerts, vp = p.vertProperties, edges = new Map();
  let bad = 0, vol = 0;
  for (let i = 0; i < tv.length; i += 3) {
    const t = [tv[i], tv[i + 1], tv[i + 2]];
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3], key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(key, (edges.get(key) || 0) + (a < b ? 1 : 1e6));
    }
    const [a, b, c] = t.map((j) => [vp[j * 3], vp[j * 3 + 1], vp[j * 3 + 2]]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  for (const v of edges.values()) if (v !== 1e6 + 1) bad++;
  return { openOrFlippedEdges: bad, volumeMM3: Math.round(vol) };
}
