#!/usr/bin/env node
/* build_relief.mjs — build the same printable relief the website exports, from the command line.
 *
 *   node tools/build_relief.mjs pulag apo --shape=round --size=120 --trail=main --out=out/relief
 *   node tools/build_relief.mjs --all --out=out/relief          # every mountain (QA sweep)
 *
 * Uses js/relief.js unchanged (the browser module), fetches Terrarium DEM tiles into
 * tools/.cache/dem/ and checks every part is a closed, outward-wound mesh.
 * Exit: 0 all good, 1 a model failed its mesh check, 2 bad arguments / environment.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { planTiles, demSampler, defaultHalfM, toLocal, buildRelief, build3MF, checkMesh, parseFont, DEM_URL }
  from "../js/relief.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "tools", ".cache", "dem");
const KNOWN = ["shape", "size", "exag", "base", "trail", "out", "all", "cell"];
const args = { shape: "round", size: "120", trail: "main", out: path.join(ROOT, "out", "relief") };
const ids = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    if (!KNOWN.includes(k)) { console.error("unknown argument " + a); process.exit(2); }
    args[k] = v ?? true;
  } else ids.push(a);
}

/* --- minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what Terrarium tiles are) */
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9];
      if (d[8] !== 8 || (ct !== 2 && ct !== 6) || d[12] !== 0) throw new Error("unsupported PNG");
    } else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3, stride = w * ch, raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0, b = y ? out[dst - stride + x] : 0, c = x >= ch && y ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { data: out, ch, size: w };
}

async function tile({ z, x, y }) {
  fs.mkdirSync(CACHE, { recursive: true });
  const fn = path.join(CACHE, `${z}_${x}_${y}.png`);
  if (!fs.existsSync(fn)) {
    const url = DEM_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        fs.writeFileSync(fn, Buffer.from(await r.arrayBuffer()));
        break;
      } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
  }
  return decodePng(fs.readFileSync(fn));
}

const mts = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "mountains.json"), "utf8")).mountains;
const todo = args.all ? mts : mts.filter((m) => ids.includes(m.id));
if (!todo.length) { console.error("no mountains selected"); process.exit(2); }
const font = parseFont(fs.readFileSync(path.join(ROOT, "assets", "fonts", "Anton-Regular.ttf")));
fs.mkdirSync(args.out, { recursive: true });

let failed = 0;
for (const m of todo) {
  const [lng0, lat0] = m.coords;
  const halfM = defaultHalfM(m.elevation_m);
  const cell = +(args.cell || 0.5), size = +args.size;
  const plan = planTiles(lng0, lat0, halfM, cell * halfM / (size / 2));
  const tiles = new Map();
  for (const t of plan.tiles) tiles.set(t.x + "/" + t.y, await tile(t));
  let trails = [];
  const tf = path.join(ROOT, "data", "trails", m.id + ".json");
  if (args.trail !== "none" && fs.existsSync(tf)) {
    const routes = JSON.parse(fs.readFileSync(tf, "utf8")).routes || [];
    const pick = args.trail === "all" ? routes
      : [routes.find((r) => r.source === "weekendgo") || routes.find((r) => r.main) || routes[0]].filter(Boolean);
    trails = pick.map((r) => r.line.map(([lng, lat]) => toLocal(lng, lat, lng0, lat0)));
  }
  const t0 = Date.now();
  const res = buildRelief({
    heightAt: demSampler(plan.z, tiles, lng0, lat0), halfM, shape: args.shape, sizeMM: size,
    exag: +(args.exag || 1.5), baseMM: +(args.base || 10), cellMM: cell,
    label: m.name.en.toUpperCase(), font, trails,
  });
  const checks = res.parts.map((p) => ({ name: p.name, ...checkMesh(p) }));
  const bad = checks.filter((c) => c.openOrFlippedEdges || c.volumeMM3 <= 0);
  const file = path.join(args.out, `${m.id}-${args.shape}-${size}mm.3mf`);
  const zip = build3MF(res.parts, { title: `${m.name.en} relief`, designer: "WeekendGo" });
  fs.writeFileSync(file, zip);
  const st = res.stats;
  console.log(`${bad.length ? "FAIL" : "ok  "} ${m.id.padEnd(18)} z${plan.z}/${plan.tiles.length}t  ${st.sizeMM}x${st.sizeMM}x${st.heightMM}mm  1:${st.scale}`
    + `  ${st.tris} tris  ${(zip.length / 1e6).toFixed(1)} MB  label ${st.label ? st.label.capMM + "mm" : "-"}`
    + `  parts ${checks.map((c) => `${c.name}(${c.openOrFlippedEdges}/${c.volumeMM3})`).join(" ")}  ${Date.now() - t0} ms`
    + (res.warnings.length ? "  WARN " + res.warnings.join(",") : ""));
  if (bad.length) failed++;
}
process.exit(failed ? 1 : 0);
