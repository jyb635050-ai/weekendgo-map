# WeekendGo · 那我走 — 菲律宾徒步 3D 地图

Philippines National Hiking Map — 69 mountains across Luzon, Visayas, Mindanao and Palawan on an interactive 3D terrain map.

**Live site:** https://jyb635050-ai.github.io/weekendgo-map/

## Features / 功能

- 🏔️ 3D satellite terrain map (MapLibre GL JS + AWS Terrain Tiles + Esri World Imagery) — drag to rotate 360°, tilt, orbit
- 📍 Difficulty-coded markers (PinoyMountaineer 1/9–9/9 scale); closed / restricted peaks ringed red / amber
- 🥾 **Multiple named routes per mountain**, each in its own colour with distance, ascent, elevation profile,
  data freshness date ("OSM 更新于 …", flagged when older than 5 years) and **GPX download**
- 📖 Guides per mountain: elevation, difficulty, trail class, time to summit, jump-off, tips, best season, sources, photos, 3-day summit weather
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

Made by **WeekendGo（那我走）** hiking collective 🇵🇭
