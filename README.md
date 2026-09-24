# WeekendGo · 那我走 — 菲律宾徒步 3D 地图

Philippines National Hiking Map — 69 mountains across Luzon, Visayas, Mindanao and Palawan on an interactive 3D terrain map.

**Live site:** https://jyb635050-ai.github.io/weekendgo-map/

## Features / 功能

- 🏔️ 3D satellite terrain map (MapLibre GL JS + AWS Terrain Tiles + Esri World Imagery) — drag to rotate 360°, tilt, orbit
- 📍 Difficulty-coded markers (PinoyMountaineer 1/9–9/9 scale); closed / restricted peaks ringed red / amber
- 🥾 **Multiple named routes per mountain**, each in its own colour with distance, ascent, elevation profile,
  data freshness date ("OSM 更新于 …", flagged when older than 5 years) and **GPX download**
- 📖 Guides per mountain: elevation, difficulty, trail class, time to summit, jump-off, tips, best season, sources, photos, 3-day summit weather
- 🖨️ **3D-print keepsake** — any mountain as a printable relief (real terrain, round or square, 80–180 mm, adjustable area /
  vertical exaggeration / base), its English name raised on the base and the hiking route raised on the surface;
  exports a multi-part **3MF** (terrain / text / route → one filament each in Bambu Studio / OrcaSlicer)
- ⭐ Personal "want to go / climbed" marks, 🌐 中文 / English, 🌙 dark / light, PWA offline cache
- 🔗 Deep links: `?m=pulag` opens a mountain directly; `?nohero=1` skips the intro

## Data sources / 数据来源

- **Mountain specs** distilled from [Pinoy Mountaineer](https://www.pinoymountaineer.com/) guide pages, with
  status checks from PHIVOLCS / LGU news. Descriptions are original bilingual writing; unverified fields show "待确认 / TBC".
- **Trails** — `tools/build_trails.py` rebuilds `data/trails/*.json` from OpenStreetMap (© OpenStreetMap contributors, ODbL):
  1. `route=hiking` relations through the summit (curated, named — e.g. Pulag's Ambangeg / Akiki / Lusod)
  2. named trail ways without a relation
  3. fallback: the longest mapped approach ("推算")

  Every route is oriented trailhead → summit, trimmed at its high point, rejected if it's a fragment or never reaches
  the upper mountain, de-duplicated by its own section, and stamped with the newest OSM edit date of the ways it uses.
  The route named after the curated jump-off is marked 主线 / Main. Re-run anytime: `python tools/build_trails.py [ids…]`.
  Hikes whose destination isn't the summit node (e.g. Pinatubo's crater) set `"trail_reach_m"` in `mountains.json`.
- **Our own GPS tracks (freshest source)** — drop GPX files in `tools/gpx-inbox/<mountain-id>/` and run
  `python tools/import_gpx.py`; they appear first as 「那我走实测」 and survive OSM rebuilds. See `tools/gpx-inbox/README.md`.

## 3D-print models / 3D 打印模型

`js/relief.js` builds the mesh (browser and Node share it): Terrarium DEM → heightfield solid with walls down to a flat
bottom, label glyphs (Anton, OFL) extruded onto the south wall, route ribbons draped on the surface; parts touch but never
overlap and are written as **one object with parts** (separate objects would each be dropped onto the bed by the slicer).

- `node tools/build_relief.mjs --all` — build every mountain and check each part is closed and outward-wound
- `python tools/slice_check.py file.3mf --colors 3` — real Bambu Studio CLI slice (recipe from `D:lenderPrintLapse`)
- `uv run --no-project --with playwright python tools/check_print3d.py` — drive the real dialog in headless Chrome
  (serve locally with `node tools/serve.mjs`)

Vendored: three.js (MIT), opentype.js (MIT), fflate (MIT) in `vendor/`.

Made by **WeekendGo（那我走）** hiking collective 🇵🇭
