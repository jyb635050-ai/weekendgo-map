#!/usr/bin/env node
/* check_summits.mjs — sanity-check candidate summit coordinates against the Terrarium DEM.
 *
 *   node tools/check_summits.mjs "id:lng,lat:ele" ...        # report DEM height at the point + the
 *                                                            # highest DEM point within 400 m
 * A coordinate whose nearby DEM peak is far lower/higher than the published elevation, or more
 * than ~300 m away, is probably not the summit.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { planTiles, demSampler, DEM_URL } from "../js/relief.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "tools", ".cache", "dem");

function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === "IDAT") idat.push(d);
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
    const r = await fetch(DEM_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    if (!r.ok) throw new Error("HTTP " + r.status);
    fs.writeFileSync(fn, Buffer.from(await r.arrayBuffer()));
  }
  return decodePng(fs.readFileSync(fn));
}

for (const arg of process.argv.slice(2)) {
  const [id, ll, ele] = arg.split(":");
  const [lng, lat] = ll.split(",").map(Number);
  const plan = planTiles(lng, lat, 600, 15);
  const tiles = new Map();
  for (const t of plan.tiles) tiles.set(t.x + "/" + t.y, await tile(t));
  const h = demSampler(plan.z, tiles, lng, lat);
  let best = { h: -1 };
  for (let y = -400; y <= 400; y += 10) for (let x = -400; x <= 400; x += 10) {
    if (x * x + y * y > 400 * 400) continue;
    const v = h(x, y);
    if (v > best.h) best = { h: v, x, y };
  }
  const dLng = best.x / (111320 * Math.cos(lat * Math.PI / 180)), dLat = best.y / 110574;
  console.log(`${id.padEnd(16)} published ${String(ele).padStart(5)} m | DEM at point ${Math.round(h(0, 0))} m | `
    + `DEM max ${Math.round(best.h)} m ${Math.round(Math.hypot(best.x, best.y))} m away -> ${(lng + dLng).toFixed(5)},${(lat + dLat).toFixed(5)}`);
}
