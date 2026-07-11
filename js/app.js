/* ============================================================
   WeekendGo · 那我走 — Philippines 3D Hiking Map
   MapLibre GL JS v5 · AWS Terrain Tiles · Esri World Imagery
   ============================================================ */
"use strict";

/* ---------- constants ---------- */
const HOME_VIEW = { center: [121.9, 11.8], zoom: 5.55, pitch: 42, bearing: -10 };
const INTRO_VIEW = { center: [121.9, 11.2], zoom: 4.85, pitch: 0, bearing: 0 };
const PH_BOUNDS = [[110.0, 1.5], [135.0, 24.5]];   // keep the camera on the Philippines
const SELECT_VIEW = { zoom: 11.6, pitch: 60 };
const REGIONS = ["cordillera", "central-luzon", "calabarzon", "bicol", "visayas", "mindanao", "islands"];

const DIFF_COLORS = {
  1: "#22C55E", 2: "#4ADE80", 3: "#A3E635",
  4: "#EAB308", 5: "#F59E0B", 6: "#F97316",
  7: "#EF4444", 8: "#DC2626", 9: "#A855F7",
};
const diffColor = (d) => DIFF_COLORS[Math.min(9, Math.max(1, d || 5))];
const diffBucket = (d) => (d <= 3 ? "easy" : d <= 6 ? "mid" : "hard");

/* ---------- state ---------- */
let map;
let mapReady;            // promise resolved on map 'load'
let mountains = [];
let activeId = null;
let hoverId = null;
let trailIds = new Set();     // mountains that have data/trails/{id}.json
const trailCache = {};
let trailToken = 0;
const wxCache = {};
let orbiting = false;
let orbitPrevTs = 0;
const filters = { q: "", region: "all", diff: "all", mark: "all" };
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- personal marks (want / done), stored locally ---------- */
let marks = {};
try { marks = JSON.parse(localStorage.getItem("wg-marks") || "{}"); } catch (e) { marks = {}; }
function setMark(id, val) {
  if (marks[id] === val) delete marks[id];      // toggle off
  else if (val) marks[id] = val;
  else delete marks[id];
  localStorage.setItem("wg-marks", JSON.stringify(marks));
  applyFilters();
}

let sortMode = "elevation";    // elevation | difficulty | name

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer = null;
function toast(msg, ms = 3200) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function animateNumber(el, target, ms = 1600) {
  if (prefersReducedMotion) { el.textContent = target.toLocaleString(); return; }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const v = Math.round(target * (1 - Math.pow(1 - p, 3)));
    el.textContent = v.toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // rAF pauses in background tabs — make sure the final value always lands
  setTimeout(() => { el.textContent = target.toLocaleString(); }, ms + 150);
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("wg-theme", theme);
  if (map && map.getLayer("sat")) {
    map.setPaintProperty("sat", "raster-brightness-max", theme === "dark" ? 0.88 : 1.0);
    map.setPaintProperty("sat", "raster-saturation", theme === "dark" ? -0.12 : 0);
  }
  if (map && map.getLayer("ph-mask")) {
    map.setPaintProperty("ph-mask", "fill-color", theme === "dark" ? "#070C18" : "#EFE4D3");
    map.setPaintProperty("ph-outline", "line-color", theme === "dark" ? "#22D3EE" : "#0891B2");
  }
}

/* ============================================================
   MAP
   ============================================================ */
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    center: INTRO_VIEW.center,
    zoom: INTRO_VIEW.zoom,
    pitch: INTRO_VIEW.pitch,
    bearing: INTRO_VIEW.bearing,
    minZoom: 4.6,
    maxZoom: 15.8,
    maxPitch: 72,
    maxBounds: PH_BOUNDS,
    hash: false,
    fadeDuration: 150,
    attributionControl: { compact: true },
    style: {
      version: 8,
      glyphs: "https://glyphs.geolonia.com/{fontstack}/{range}.pbf",
      sources: {
        sat: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 18,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        },
        dem: {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 12,
          attribution: "Terrain: Mapzen/AWS Open Data",
        },
        hills: {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 12,
        },
      },
      layers: [
        { id: "sat", type: "raster", source: "sat" },
        {
          id: "hillshade", type: "hillshade", source: "hills",
          paint: {
            "hillshade-exaggeration": 0.38,
            "hillshade-shadow-color": "#0b1220",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#1e293b",
          },
        },
      ],
      sky: {
        "sky-color": "#7cb8e8",
        "horizon-color": "#e8d3b0",
        "fog-color": "#c8d8e8",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.7,
        "fog-ground-blend": 0.72,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 8, 0.18, 11, 0],
      },
      terrain: { source: "dem", exaggeration: 1.45 },
    },
  });

  map.touchZoomRotate.enableRotation();
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), "bottom-right");
  map.on("dragstart", stopOrbit);
  map.on("wheel", stopOrbit);
  map.on("error", (e) => console.warn("[map]", e && e.error && e.error.message));

  // clicking empty map closes the detail panel
  map.on("click", (e) => {
    if (!map.getLayer("peaks-dot")) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: ["peaks-dot"] });
    if (!hits.length && $("#detail").classList.contains("open")) closeDetail();
  });

  mapReady = new Promise((resolve) => map.on("load", resolve));
  map.on("load", () => {
    applyTheme(document.documentElement.dataset.theme);
  });
}

/* ---------- orbit ---------- */
function orbitFrame(ts) {
  if (!orbiting) return;
  if (orbitPrevTs) {
    const dt = ts - orbitPrevTs;
    map.setBearing(map.getBearing() + dt * 0.0026);
  }
  orbitPrevTs = ts;
  requestAnimationFrame(orbitFrame);
}
function startOrbit() {
  if (orbiting || prefersReducedMotion) return;
  orbiting = true;
  orbitPrevTs = 0;
  $("#btn-orbit").classList.add("active");
  requestAnimationFrame(orbitFrame);
}
function stopOrbit() {
  orbiting = false;
  $("#btn-orbit").classList.remove("active");
}

/* ============================================================
   PEAK LAYERS (in-canvas — always registered with 3D terrain)
   ============================================================ */
function peaksGeoJSON() {
  return {
    type: "FeatureCollection",
    features: mountains.map((m) => ({
      type: "Feature",
      id: m.id,
      geometry: { type: "Point", coordinates: m.coords },
      properties: {
        id: m.id,
        color: diffColor(m.difficulty),
        name_zh: m.name.zh || m.name.en,
        name_en: m.name.en || m.name.zh,
        elevation: m.elevation_m,
        difficulty: m.difficulty,
      },
    })),
  };
}

/* Everything outside the Philippines is dimmed away; a soft outline frames the country. */
function buildMaskLayers(ph) {
  const dark = document.documentElement.dataset.theme === "dark";
  map.addSource("ph-mask", { type: "geojson", data: ph.mask });
  map.addSource("ph-outline", { type: "geojson", data: ph.outline });
  map.addLayer({
    id: "ph-mask", type: "fill", source: "ph-mask",
    paint: {
      "fill-color": dark ? "#070C18" : "#EFE4D3",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4.6, 0.94, 6.5, 0.82, 8, 0.4, 9.5, 0],
    },
  });
  map.addLayer({
    id: "ph-outline", type: "line", source: "ph-outline",
    paint: {
      "line-color": dark ? "#22D3EE" : "#0891B2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4.6, 1.1, 9, 0.5],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4.6, 0.5, 8, 0.25, 9.5, 0],
      "line-blur": 0.6,
    },
  });
}

const activeCase = (on, off) => ["case", ["boolean", ["feature-state", "active"], false], on, off];
const hoverOrActive = (on, off) => ["case",
  ["any", ["boolean", ["feature-state", "active"], false], ["boolean", ["feature-state", "hover"], false]],
  on, off];

function buildPeakLayers() {
  map.addSource("peaks", { type: "geojson", data: peaksGeoJSON(), promoteId: "id" });

  map.addLayer({
    id: "peaks-glow", type: "circle", source: "peaks",
    paint: {
      "circle-radius": hoverOrActive(16, 10),
      "circle-color": ["get", "color"],
      "circle-blur": 1.1,
      "circle-opacity": hoverOrActive(0.85, 0.5),
    },
  });
  map.addLayer({
    id: "peaks-dot", type: "circle", source: "peaks",
    paint: {
      "circle-radius": hoverOrActive(8, 5.5),
      "circle-color": ["get", "color"],
      "circle-stroke-width": activeCase(2.5, 1.8),
      "circle-stroke-color": "rgba(255,255,255,0.95)",
    },
  });
  map.addLayer({
    id: "peaks-label", type: "symbol", source: "peaks",
    minzoom: 6.2,
    layout: {
      "text-field": ["get", LANG === "zh" ? "name_zh" : "name_en"],
      "text-font": ["Noto Sans CJK JP Regular"],
      "text-size": 12,
      "text-offset": [0, 1.15],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#FFFFFF",
      "text-halo-color": "rgba(8,12,24,0.85)",
      "text-halo-width": 1.4,
    },
  });

  // interactions
  map.on("click", "peaks-dot", (e) => {
    const f = e.features && e.features[0];
    if (f) selectMountain(f.properties.id);
  });
  const tip = $("#map-tip");
  map.on("mousemove", "peaks-dot", (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    map.getCanvas().style.cursor = "pointer";
    if (hoverId && hoverId !== f.properties.id) map.setFeatureState({ source: "peaks", id: hoverId }, { hover: false });
    hoverId = f.properties.id;
    map.setFeatureState({ source: "peaks", id: hoverId }, { hover: true });
    const m = mountains.find((x) => x.id === hoverId);
    tip.innerHTML = `<b>${esc(loc(m.name))}</b><span>${m.elevation_m.toLocaleString()} m · ${m.difficulty}/9</span>`;
    tip.style.left = `${e.point.x}px`;
    tip.style.top = `${e.point.y}px`;
    tip.hidden = false;
  });
  map.on("mouseleave", "peaks-dot", () => {
    map.getCanvas().style.cursor = "";
    if (hoverId) map.setFeatureState({ source: "peaks", id: hoverId }, { hover: false });
    hoverId = null;
    tip.hidden = true;
  });
}

function setActivePeak(id) {
  if (activeId && activeId !== id) map.setFeatureState({ source: "peaks", id: activeId }, { active: false });
  if (id) map.setFeatureState({ source: "peaks", id }, { active: true });
  activeId = id;
}

function refreshMarkerLabels() {
  if (map.getLayer("peaks-label")) {
    map.setLayoutProperty("peaks-label", "text-field", ["get", LANG === "zh" ? "name_zh" : "name_en"]);
  }
}

/* ============================================================
   FILTERING
   ============================================================ */
function visibleMountains() {
  const q = filters.q.trim().toLowerCase();
  return mountains.filter((m) => {
    if (filters.region !== "all" && m.region_key !== filters.region) return false;
    if (filters.diff !== "all" && diffBucket(m.difficulty) !== filters.diff) return false;
    if (filters.mark !== "all" && marks[m.id] !== filters.mark) return false;
    if (q) {
      const hay = `${m.name.zh || ""} ${m.name.en || ""} ${loc(m.province)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function applyFilters() {
  const vis = visibleMountains();
  const visIds = vis.map((m) => m.id);
  if (map.getLayer("peaks-dot")) {
    const filter = ["in", ["get", "id"], ["literal", visIds]];
    ["peaks-glow", "peaks-dot", "peaks-label"].forEach((l) => map.setFilter(l, filter));
  }
  renderList(vis);
}

/* ============================================================
   LIST DRAWER
   ============================================================ */
const MARK_ICONS = {
  want: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9L12 2.8Z"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5.5 5.5L20 6.5"/></svg>',
};
const SORT_MODES = ["elevation", "difficulty", "name"];
function sortList(vis) {
  const arr = [...vis];
  if (sortMode === "difficulty") arr.sort((a, b) => b.difficulty - a.difficulty || b.elevation_m - a.elevation_m);
  else if (sortMode === "name") arr.sort((a, b) => loc(a.name).localeCompare(loc(b.name), LANG === "zh" ? "zh-Hans-CN" : "en"));
  else arr.sort((a, b) => b.elevation_m - a.elevation_m);
  return arr;
}

let listAnimated = false;
function renderList(vis) {
  const body = $("#list-body");
  $("#list-count").textContent = vis.length;
  // marks progress + tab states
  const doneCount = mountains.filter((m) => marks[m.id] === "done").length;
  const prog = $("#mark-progress");
  if (prog) prog.textContent = `${t("mark.progress")} ${doneCount}/${mountains.length}`;
  document.querySelectorAll("#mark-tabs .mtab").forEach((b) => b.classList.toggle("on", b.dataset.mark === filters.mark));
  const sb = $("#btn-sort");
  if (sb) sb.querySelector("span").textContent = t("sort." + sortMode);

  if (!vis.length) {
    body.innerHTML = `<div class="list-empty">${esc(t("list.empty")).replace(/\n/g, "<br>")}</div>`;
    return;
  }
  const animCls = listAnimated ? "no-anim" : "";
  listAnimated = true;
  const sorted = sortList(vis);
  body.innerHTML = sorted.map((m, i) => `
    <button class="m-card ${m.id === activeId ? "active" : ""} ${animCls}" data-id="${esc(m.id)}" style="--i:${Math.min(i, 20)}">
      <div class="m-card-bar" style="background:${diffColor(m.difficulty)}"></div>
      <div class="m-card-main">
        <div class="m-card-name">${esc(loc(m.name))}${marks[m.id] ? `<span class="m-mark ${marks[m.id]}">${MARK_ICONS[marks[m.id]]}</span>` : ""}</div>
        <div class="m-card-sub">${esc(t("region." + m.region_key))} · ${esc(loc(m.province))}</div>
      </div>
      <div class="m-card-right">
        <div class="m-card-elev">${m.elevation_m.toLocaleString()}<small> m</small></div>
        <div class="m-card-diff" style="color:${diffColor(m.difficulty)}">${m.difficulty}/9</div>
      </div>
    </button>
  `).join("");
  body.querySelectorAll(".m-card").forEach((card) => {
    card.addEventListener("click", () => selectMountain(card.dataset.id));
  });
}

function highlightActiveCard() {
  document.querySelectorAll(".m-card").forEach((c) => c.classList.toggle("active", c.dataset.id === activeId));
  const active = document.querySelector(".m-card.active");
  if (active) active.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
}

/* ============================================================
   DETAIL PANEL
   ============================================================ */
function renderDetail(m) {
  const dc = diffColor(m.difficulty);
  const [lng, lat] = m.coords;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const tbc = `<span style="color:var(--text-3)">${esc(t("d.tbc"))}</span>`;

  const highlights = (m.highlights || []).map((h) => `<span class="d-tag">${esc(loc(h))}</span>`).join("");
  const sources = (m.sources || []).map((s) => {
    let host = s; try { host = new URL(s).hostname.replace(/^www\./, ""); } catch (_) {}
    return `<a class="d-link" href="${esc(s)}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 19"/></svg>
      <span>${esc(host)}</span></a>`;
  }).join("");

  $("#detail-body").innerHTML = `
    <div class="d-region">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
      ${esc(t("region." + m.region_key))} · ${esc(loc(m.province))}
    </div>
    <h2 class="d-name">${esc(loc(m.name))}</h2>
    <div class="d-name-alt">${esc(LANG === "zh" ? (m.name.en || "") : (m.name.zh || ""))}</div>

    ${(m.photos && m.photos.length) ? `<div class="d-photos-wrap${m.photos.length > 1 ? " multi" : ""}">
      <div class="d-photos" id="d-photos">${m.photos.map((p) => `
      <figure class="d-photo">
        <a href="${esc(p.p)}" target="_blank" rel="noopener"><img src="${esc(p.u)}" alt="${esc(loc(m.name))}" loading="lazy" onerror="this.closest('figure').remove()"></a>
        <figcaption>© ${esc(p.by)} · ${esc(p.lic)}</figcaption>
      </figure>`).join("")}</div>
      ${m.photos.length > 1 ? `
      <button class="d-photo-arrow prev" id="photo-prev" aria-label="${esc(t("photo.prev"))}" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>
      </button>
      <button class="d-photo-arrow next" id="photo-next" aria-label="${esc(t("photo.next"))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      </button>
      <div class="d-photo-dots">${m.photos.map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("")}</div>` : ""}
    </div>` : ""}

    <div class="d-badges">
      <span class="badge badge-diff" style="background:${dc}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
        ${esc(t("diff.label"))} ${m.difficulty}/9 · ${esc(t("diff." + m.difficulty))}
      </span>
      ${m.trail_class ? `<span class="badge">${esc(t("trailClass"))} ${m.trail_class}</span>` : ""}
      <span class="badge">${esc(t("type." + (m.type || "minor")))}</span>
    </div>

    ${m.status ? `<div class="d-status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span>${esc(loc(m.status))}</span>
    </div>` : ""}

    <div class="d-stats">
      <div class="d-stat">
        <div class="d-stat-val">${m.elevation_m.toLocaleString()}<small> m</small></div>
        <div class="d-stat-label">${esc(t("d.elevation"))}</div>
      </div>
      <div class="d-stat">
        <div class="d-stat-val" style="font-size:14.5px;line-height:1.35">${m.time_to_summit ? esc(loc(m.time_to_summit)) : tbc}</div>
        <div class="d-stat-label">${esc(t("d.timeToSummit"))}</div>
      </div>
      <div class="d-stat">
        <div class="d-stat-val" style="font-size:14.5px;line-height:1.35">${m.duration ? esc(loc(m.duration)) : tbc}</div>
        <div class="d-stat-label">${esc(t("d.duration"))}</div>
      </div>
    </div>

    <div class="d-section" id="trail-sec" hidden>
      <h3>${esc(t("d.trail"))}</h3>
      <div id="trail-body"></div>
    </div>

    <div class="d-section">
      <h3>${esc(t("wx.title"))}</h3>
      <div class="wx" id="wx-box"><div class="wx-skel"></div><div class="wx-skel"></div><div class="wx-skel"></div></div>
    </div>

    ${m.summary ? `<div class="d-section"><h3>${esc(t("d.summary"))}</h3><p>${esc(loc(m.summary))}</p></div>` : ""}
    ${highlights ? `<div class="d-section"><h3>${esc(t("d.highlights"))}</h3><div class="d-tags">${highlights}</div></div>` : ""}

    <div class="d-section">
      <h3>${esc(t("d.info"))}</h3>
      <dl class="d-kv">
        <div class="d-kv-row"><dt>${esc(t("d.jumpoff"))}</dt><dd>${m.jumpoff ? esc(loc(m.jumpoff)) : tbc}</dd></div>
        <div class="d-kv-row"><dt>${esc(t("d.season"))}</dt><dd>${m.best_season ? esc(loc(m.best_season)) : tbc}</dd></div>
        <div class="d-kv-row"><dt>${esc(t("d.province"))}</dt><dd>${esc(loc(m.province))}</dd></div>
      </dl>
    </div>

    ${m.tips ? `<div class="d-section"><h3>${esc(t("d.tips"))}</h3><p>${esc(loc(m.tips))}</p></div>` : ""}
    ${sources ? `<div class="d-section"><h3>${esc(t("d.sources"))}</h3><div class="d-links">${sources}</div></div>` : ""}

    <div class="d-marks">
      <button class="d-mark want ${marks[m.id] === "want" ? "on" : ""}" data-mark="want" title="${esc(t("mark.deviceNote"))}">
        ${MARK_ICONS.want}<span>${esc(t("mark.want"))}</span>
      </button>
      <button class="d-mark done ${marks[m.id] === "done" ? "on" : ""}" data-mark="done" title="${esc(t("mark.deviceNote"))}">
        ${MARK_ICONS.done}<span>${esc(t("mark.done"))}</span>
      </button>
    </div>

    <div class="d-actions">
      <a class="d-btn d-btn-primary" href="${esc(gmaps)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        ${esc(t("d.gmaps"))}
      </a>
      <button class="d-btn d-btn-ghost" id="btn-refly">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h5l2-7 4 14 2-7h7"/></svg>
        ${esc(t("d.flyto"))}
      </button>
    </div>

    ${m.verified === false ? `<div class="d-flag">${esc(t("d.unverified"))}</div>` : ""}
  `;
  const refly = $("#btn-refly");
  if (refly) refly.addEventListener("click", () => flyToMountain(m));

  // want / done toggles
  document.querySelectorAll("#detail-body .d-mark").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMark(m.id, btn.dataset.mark);
      document.querySelectorAll("#detail-body .d-mark").forEach((b) =>
        b.classList.toggle("on", marks[m.id] === b.dataset.mark));
    });
  });

  // photo carousel navigation
  const strip = $("#d-photos");
  if (strip && (m.photos || []).length > 1) {
    const prev = $("#photo-prev"), next = $("#photo-next");
    const dots = [...document.querySelectorAll(".d-photo-dots span")];
    const step = () => {
      const fig = strip.querySelector(".d-photo");
      return fig ? fig.getBoundingClientRect().width + 9 : strip.clientWidth;
    };
    const sync = () => {
      const idx = Math.round(strip.scrollLeft / step());
      dots.forEach((d, i) => d.classList.toggle("on", i === idx));
      if (prev) prev.hidden = strip.scrollLeft < 8;
      if (next) next.hidden = strip.scrollLeft > strip.scrollWidth - strip.clientWidth - 8;
    };
    prev && prev.addEventListener("click", () => strip.scrollBy({ left: -step(), behavior: "smooth" }));
    next && next.addEventListener("click", () => strip.scrollBy({ left: step(), behavior: "smooth" }));
    strip.addEventListener("scroll", sync, { passive: true });
  }
}

function openDetail() { $("#detail").classList.add("open"); $("#detail").setAttribute("aria-hidden", "false"); }
function closeDetail() {
  $("#detail").classList.remove("open");
  $("#detail").setAttribute("aria-hidden", "true");
  setActivePeak(null);
  stopOrbit();
  clearTrailLayers();
  highlightActiveCard();
}

/* ============================================================
   WEATHER (Open-Meteo, downscaled to summit elevation)
   ============================================================ */
const WX_ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2m0 15v2M4.8 4.8l1.4 1.4m11.6 11.6 1.4 1.4M2.5 12h2m15 0h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4"/></svg>',
  psun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8" r="3"/><path d="M8.5 1.8v1.4M2.3 8h1.4M4.1 3.6l1 1M13 3.6l-1 1"/><path d="M9 21h8.5a3.5 3.5 0 0 0 .6-6.95 5 5 0 0 0-9.6-1.4A4 4 0 0 0 9 21Z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 19h11a4 4 0 0 0 .8-7.92 6 6 0 0 0-11.6-1.7A4.5 4.5 0 0 0 6.5 19Z"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M2.5 13h19M5 17h14"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 15h11a4 4 0 0 0 .8-7.92 6 6 0 0 0-11.6-1.7A4.5 4.5 0 0 0 6.5 15Z"/><path d="M8 18.5l-1 2.5m5.5-2.5-1 2.5m5.5-2.5-1 2.5"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 15h11a4 4 0 0 0 .8-7.92 6 6 0 0 0-11.6-1.7A4.5 4.5 0 0 0 6.5 15Z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/></svg>',
  storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 14h11a4 4 0 0 0 .8-7.92 6 6 0 0 0-11.6-1.7A4.5 4.5 0 0 0 6.5 14Z"/><path d="m12.5 15-2.5 4h3l-2 3.5"/></svg>',
};
const WX_DROP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5s5.5 6.2 5.5 10a5.5 5.5 0 0 1-11 0c0-3.8 5.5-10 5.5-10Z"/></svg>';

function wmoInfo(code) {
  if (code === 0) return { key: "sun", icon: "sun" };
  if (code <= 2) return { key: "psun", icon: "psun" };
  if (code === 3) return { key: "cloud", icon: "cloud" };
  if (code === 45 || code === 48) return { key: "fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { key: "drizzle", icon: "rain" };
  if (code >= 61 && code <= 67) return { key: "rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { key: "snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { key: "shower", icon: "rain" };
  if (code >= 85 && code <= 86) return { key: "snow", icon: "snow" };
  if (code >= 95) return { key: "storm", icon: "storm" };
  return { key: "cloud", icon: "cloud" };
}

async function loadWeather(m) {
  const paint = (html) => {
    const box = $("#wx-box");
    if (box && activeId === m.id) box.innerHTML = html;
  };
  try {
    let data = wxCache[m.id];
    if (!data) {
      const [lng, lat] = m.coords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&elevation=${m.elevation_m}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FManila&forecast_days=3`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      wxCache[m.id] = data;
    }
    const d = data.daily;
    const labels = [t("wx.today"), t("wx.tomorrow"), t("wx.day2")];
    paint(d.time.map((_, i) => {
      const w = wmoInfo(d.weather_code[i]);
      const rain = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;
      return `<div class="wx-day">
        <span class="wx-label">${esc(labels[i])}</span>
        <span class="wx-icon">${WX_ICONS[w.icon]}</span>
        <span class="wx-desc">${esc(t("wx." + w.key))}</span>
        <span class="wx-temp">${Math.round(d.temperature_2m_max[i])}°<small>/${Math.round(d.temperature_2m_min[i])}°</small></span>
        <span class="wx-rain">${WX_DROP}${rain == null ? "–" : rain}%</span>
      </div>`;
    }).join(""));
  } catch (err) {
    paint(`<div class="wx-fail">${esc(t("wx.fail"))}</div>`);
  }
}

/* ============================================================
   TRAILS (OSM route + elevation profile)
   ============================================================ */
const TRAIL_LAYERS = ["trail-net", "trail-route-glow", "trail-route", "trail-pos"];

function clearTrailLayers() {
  TRAIL_LAYERS.forEach((l) => { if (map.getLayer(l)) map.removeLayer(l); });
  ["trail-net", "trail-route", "trail-pos"].forEach((s) => { if (map.getSource(s)) map.removeSource(s); });
}

function addTrailLayers(tr) {
  clearTrailLayers();
  const before = map.getLayer("peaks-glow") ? "peaks-glow" : undefined;
  map.addSource("trail-net", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: tr.net || [] } },
  });
  map.addSource("trail-route", {
    type: "geojson",
    attribution: "Trails © OpenStreetMap contributors",
    data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: tr.route } },
  });
  map.addLayer({
    id: "trail-net", type: "line", source: "trail-net",
    paint: { "line-color": "rgba(255,255,255,0.38)", "line-width": 1.1, "line-dasharray": [2, 2.5] },
  }, before);
  map.addLayer({
    id: "trail-route-glow", type: "line", source: "trail-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#FB923C", "line-width": 8, "line-blur": 4, "line-opacity": 0.4 },
  }, before);
  map.addLayer({
    id: "trail-route", type: "line", source: "trail-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#FB923C", "line-width": 2.6 },
  }, before);
  // hover position dot (driven by the elevation profile)
  map.addSource("trail-pos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "trail-pos", type: "circle", source: "trail-pos",
    paint: { "circle-radius": 6, "circle-color": "#FFFFFF", "circle-stroke-width": 3, "circle-stroke-color": "#FB923C" },
  }, before);
}

function profileSVG(tr) {
  const ele = tr.ele || [];
  if (ele.length < 5) return "";
  const W = 340, H = 118, L = 36, R = 8, T = 12, B = 20;
  const min = Math.min(...ele), max = Math.max(...ele);
  const span = Math.max(max - min, 10);
  const x = (i) => L + (W - L - R) * i / (ele.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
  let d = `M${x(0).toFixed(1)},${y(ele[0]).toFixed(1)}`;
  for (let i = 1; i < ele.length; i++) d += `L${x(i).toFixed(1)},${y(ele[i]).toFixed(1)}`;
  const area = `${d}L${x(ele.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  return `<svg viewBox="0 0 ${W} ${H}" class="pf-svg" role="img" aria-label="elevation profile">
    <defs><linearGradient id="pf-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FB923C" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#FB923C" stop-opacity="0"/>
    </linearGradient></defs>
    <line x1="${L}" y1="${y(max)}" x2="${W - R}" y2="${y(max)}" class="pf-grid"/>
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="pf-grid"/>
    <path d="${area}" fill="url(#pf-g)"/>
    <path d="${d}" fill="none" stroke="#FB923C" stroke-width="2" stroke-linejoin="round"/>
    <text x="${L - 5}" y="${y(max) + 4}" class="pf-lb" text-anchor="end">${max}</text>
    <text x="${L - 5}" y="${H - B + 4}" class="pf-lb" text-anchor="end">${min}</text>
    <text x="${L}" y="${H - 5}" class="pf-lb">0</text>
    <text x="${W - R}" y="${H - 5}" class="pf-lb" text-anchor="end">${tr.dist_km} km</text>
    <line class="pf-cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="pf-cursor-dot" r="3.5" visibility="hidden"/>
  </svg>`;
}

/* interactive hover on the elevation profile: cursor line + tip + map position dot */
function attachProfileHover(wrap, tr) {
  const svg = wrap.querySelector(".pf-svg");
  const tip = wrap.querySelector(".pf-tip");
  if (!svg || !tip) return;
  const cursor = svg.querySelector(".pf-cursor");
  const dot = svg.querySelector(".pf-cursor-dot");
  const W = 340, H = 118, L = 36, R = 8, T = 12, B = 20;
  const ele = tr.ele, n = ele.length;
  const min = Math.min(...ele), span = Math.max(Math.max(...ele) - min, 10);
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const xu = (clientX - rect.left) / rect.width * W;
    const frac = Math.min(1, Math.max(0, (xu - L) / (W - L - R)));
    const i = Math.round(frac * (n - 1));
    const x = L + (W - L - R) * i / (n - 1);
    const yy = T + (H - T - B) * (1 - (ele[i] - min) / span);
    cursor.setAttribute("x1", x); cursor.setAttribute("x2", x); cursor.removeAttribute("visibility");
    dot.setAttribute("cx", x); dot.setAttribute("cy", yy); dot.removeAttribute("visibility");
    tip.hidden = false;
    tip.textContent = `${(frac * tr.dist_km).toFixed(1)} km · ${ele[i]} m`;
    tip.style.left = `${(x / W) * 100}%`;
    const src = map.getSource("trail-pos");
    if (src && tr.route[i]) src.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: tr.route[i] } });
  };
  const leave = () => {
    cursor.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
    const src = map.getSource("trail-pos");
    if (src) src.setData({ type: "FeatureCollection", features: [] });
  };
  svg.addEventListener("mousemove", (e) => move(e.clientX));
  svg.addEventListener("mouseleave", leave);
  svg.addEventListener("touchmove", (e) => move(e.touches[0].clientX), { passive: true });
  svg.addEventListener("touchend", leave);
}

async function showTrail(m) {
  clearTrailLayers();
  if (!trailIds.has(m.id)) return;
  const token = ++trailToken;
  let tr = trailCache[m.id];
  if (!tr) {
    try {
      const res = await fetch(`data/trails/${m.id}.json`);
      if (!res.ok) return;
      tr = await res.json();
      trailCache[m.id] = tr;
    } catch (err) { return; }
  }
  if (token !== trailToken || activeId !== m.id) return;   // superseded selection
  addTrailLayers(tr);
  const sec = $("#trail-sec");
  if (sec) {
    sec.hidden = false;
    sec.querySelector("#trail-body").innerHTML = `
      <div class="pf-stats">
        <span><b>${tr.dist_km}</b> km · ${esc(t("d.trailOneWay"))}</span>
        <span><b>+${tr.ascent_m.toLocaleString()}</b> m · ${esc(t("d.trailAscent"))}</span>
      </div>
      <div class="pf-wrap">${profileSVG(tr)}<div class="pf-tip" hidden></div></div>
      <p class="pf-note">${esc(t("d.trailNote"))}</p>`;
    attachProfileHover(sec.querySelector(".pf-wrap"), tr);
  }
}

/* ============================================================
   SELECTION & CAMERA
   ============================================================ */
function flyToMountain(m) {
  stopOrbit();
  map.flyTo({
    center: m.coords,
    zoom: SELECT_VIEW.zoom,
    pitch: SELECT_VIEW.pitch,
    bearing: (map.getBearing() + 30) % 360,
    duration: prefersReducedMotion ? 0 : 2200,
    curve: 1.32,
    essential: true,
  });
}

function selectMountain(id) {
  const m = mountains.find((x) => x.id === id);
  if (!m) return;
  setActivePeak(id);
  renderDetail(m);
  openDetail();
  highlightActiveCard();
  showTrail(m);
  loadWeather(m);
  flyToMountain(m);
  // on mobile, close the list sheet so the map + detail are visible
  if (window.matchMedia("(max-width: 860px)").matches) setDrawer(false);
}

/* ============================================================
   UI CHROME
   ============================================================ */
function setDrawer(open) {
  const d = $("#list-drawer");
  d.classList.toggle("closed", !open);
  d.setAttribute("aria-hidden", String(!open));
}

function revealUI() {
  ["#topbar", "#hud", "#legend"].forEach((s) => { $(s).classList.remove("ui-hidden"); $(s).setAttribute("aria-hidden", "false"); });
  setDrawer(!window.matchMedia("(max-width: 860px)").matches);
}

function populateRegionSelect() {
  const sel = $("#filter-region");
  sel.innerHTML = `<option value="all">${esc(t("filter.allRegions"))}</option>` +
    REGIONS.map((r) => `<option value="${r}" ${filters.region === r ? "selected" : ""}>${esc(t("region." + r))}</option>`).join("");
  sel.value = filters.region;
}

/* ---------- search ---------- */
let kbIndex = -1;
function renderSearchResults() {
  const box = $("#search-results");
  const q = filters.q.trim().toLowerCase();
  if (!q) { box.hidden = true; box.innerHTML = ""; kbIndex = -1; return; }
  const hits = mountains.filter((m) =>
    `${m.name.zh || ""} ${m.name.en || ""} ${loc(m.province)}`.toLowerCase().includes(q)
  ).slice(0, 8);
  box.hidden = false;
  kbIndex = -1;
  box.innerHTML = hits.length
    ? hits.map((m) => `
        <button class="search-item" data-id="${esc(m.id)}">
          <span class="search-item-dot" style="background:${diffColor(m.difficulty)}"></span>
          <span class="search-item-name">${esc(loc(m.name))}</span>
          <span class="search-item-sub">${m.elevation_m.toLocaleString()} m · ${m.difficulty}/9</span>
        </button>`).join("")
    : `<div class="search-empty">${esc(t("search.empty"))}</div>`;
  box.querySelectorAll(".search-item").forEach((it) => {
    it.addEventListener("click", () => {
      selectMountain(it.dataset.id);
      box.hidden = true;
      $("#search-input").value = "";
      filters.q = "";
      applyFilters();
    });
  });
}

function bindSearch() {
  const input = $("#search-input");
  const box = $("#search-results");
  input.addEventListener("input", () => {
    filters.q = input.value;
    renderSearchResults();
    applyFilters();
  });
  input.addEventListener("keydown", (e) => {
    const items = [...box.querySelectorAll(".search-item")];
    if (e.key === "Escape") { box.hidden = true; input.blur(); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      kbIndex = (kbIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle("kb-active", i === kbIndex));
      items[kbIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && kbIndex >= 0) {
      e.preventDefault();
      items[kbIndex].click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!$("#search-box").contains(e.target)) box.hidden = true;
  });
}

/* ---------- responsive filter placement ---------- */
const narrowMQ = window.matchMedia("(max-width: 1120px)");
function placeFilters() {
  const filters = document.querySelector(".topbar-filters");
  if (!filters) return;
  if (narrowMQ.matches) {
    $("#drawer-filters").appendChild(filters);
  } else {
    const topbar = $("#topbar");
    topbar.insertBefore(filters, topbar.querySelector(".topbar-actions"));
  }
}

/* ---------- events ---------- */
function bindUI() {
  $("#hero-cta").addEventListener("click", dismissHero);
  placeFilters();
  narrowMQ.addEventListener("change", placeFilters);

  $("#btn-lang").addEventListener("click", () => setLang(LANG === "zh" ? "en" : "zh"));
  $("#btn-theme").addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  $("#btn-list").addEventListener("click", () => setDrawer($("#list-drawer").classList.contains("closed")));
  $("#btn-list-close").addEventListener("click", () => setDrawer(false));
  $("#btn-detail-close").addEventListener("click", closeDetail);

  $("#btn-home-view").addEventListener("click", () => {
    closeDetail();
    map.flyTo({ ...HOME_VIEW, duration: prefersReducedMotion ? 0 : 2600, essential: true });
  });
  const brandHome = $("#brand-home");
  brandHome.addEventListener("click", () => $("#btn-home-view").click());
  brandHome.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("#btn-home-view").click(); });

  $("#btn-orbit").addEventListener("click", () => {
    if (orbiting) { stopOrbit(); return; }
    startOrbit();
    toast(t("toast.orbitOn"));
  });

  $("#filter-region").addEventListener("change", (e) => { filters.region = e.target.value; applyFilters(); });
  $("#filter-difficulty").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filters.diff = chip.dataset.diff;
    document.querySelectorAll("#filter-difficulty .chip").forEach((c) => c.classList.toggle("active", c === chip));
    applyFilters();
  });

  bindSearch();

  // join-us modal
  const joinModal = $("#join-modal");
  const setJoin = (open) => { joinModal.hidden = !open; document.body.classList.toggle("modal-open", open); };
  $("#btn-join").addEventListener("click", () => setJoin(true));
  joinModal.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) setJoin(false); });

  // mark tabs (all / want / done)
  $("#mark-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".mtab");
    if (!b) return;
    filters.mark = b.dataset.mark;
    applyFilters();
  });

  // sort mode cycle
  $("#btn-sort").addEventListener("click", () => {
    sortMode = SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length];
    renderList(visibleMountains());
  });

  // swipe-down to close bottom sheets (mobile)
  const addSwipeClose = (zone, canStart, onClose) => {
    let y0 = null;
    zone.addEventListener("touchstart", (e) => { y0 = canStart() ? e.touches[0].clientY : null; }, { passive: true });
    zone.addEventListener("touchmove", (e) => {
      if (y0 !== null && e.touches[0].clientY - y0 > 64) { y0 = null; onClose(); }
    }, { passive: true });
    zone.addEventListener("touchend", () => { y0 = null; }, { passive: true });
  };
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  addSwipeClose(document.querySelector("#list-drawer .drawer-head"), isMobile, () => setDrawer(false));
  const detailScroll = document.querySelector("#detail .detail-scroll");
  addSwipeClose(detailScroll, () => isMobile() && detailScroll.scrollTop <= 0, closeDetail);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!joinModal.hidden) { setJoin(false); return; }
      if (!$("#search-results").hidden) return; // search handles its own esc
      if ($("#detail").classList.contains("open")) closeDetail();
    }
  });

  document.addEventListener("wg:langchange", () => {
    populateRegionSelect();
    refreshMarkerLabels();
    applyFilters();
    if (activeId) {
      const m = mountains.find((x) => x.id === activeId);
      if (m) { renderDetail(m); showTrail(m); loadWeather(m); }
    }
  });
}

/* ---------- hero ---------- */
function dismissHero() {
  const hero = $("#hero");
  if (hero.classList.contains("hero-hidden")) return;
  hero.classList.add("hero-hidden");
  hero.setAttribute("aria-hidden", "true");
  revealUI();
  map.flyTo({ ...HOME_VIEW, duration: prefersReducedMotion ? 0 : 3000, essential: true, curve: 1.2 });
  setTimeout(() => { hero.remove(); }, 1000);
}

function fillHeroStats() {
  animateNumber($("#stat-mountains"), mountains.length);
  animateNumber($("#stat-regions"), new Set(mountains.map((m) => m.region_key)).size);
  animateNumber($("#stat-highest"), Math.max(...mountains.map((m) => m.elevation_m)));
}

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  applyTheme(localStorage.getItem("wg-theme") || "dark");
  applyI18nDom();
  initMap();
  bindUI();

  let phBoundary = null;
  try {
    const [res, phRes, trRes] = await Promise.all([
      fetch("data/mountains.json"),
      fetch("data/ph.json").catch(() => null),
      fetch("data/trails/index.json").catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mountains = data.mountains || [];
    if (phRes && phRes.ok) phBoundary = await phRes.json();
    if (trRes && trRes.ok) trailIds = new Set(await trRes.json());
  } catch (err) {
    console.error("[data]", err);
    toast(t("toast.loadFail"), 6000);
    return;
  }

  populateRegionSelect();
  fillHeroStats();
  renderList(visibleMountains());

  // deep links: ?m=<mountain-id> jumps straight to a mountain; ?nohero=1 skips the intro
  const qp = new URLSearchParams(location.search);
  const deepLink = qp.has("m") || qp.has("nohero");
  if (deepLink) {
    const hero = $("#hero");
    if (hero) hero.remove();
    revealUI();
    const target = mountains.find((x) => x.id === qp.get("m"));
    if (target) {
      map.jumpTo({ center: target.coords, zoom: SELECT_VIEW.zoom, pitch: SELECT_VIEW.pitch, bearing: 35 });
    } else {
      map.jumpTo(HOME_VIEW);
    }
  }

  await mapReady;
  if (phBoundary) buildMaskLayers(phBoundary);
  buildPeakLayers();
  applyFilters();

  if (deepLink) {
    const target = mountains.find((x) => x.id === qp.get("m"));
    if (target) {
      setActivePeak(target.id);
      renderDetail(target);
      openDetail();
      highlightActiveCard();
      showTrail(target);
      loadWeather(target);
    }
  }
})();

/* ============================================================
   PWA — offline tile/asset caching (https only)
   ============================================================ */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
