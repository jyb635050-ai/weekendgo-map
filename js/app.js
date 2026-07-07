/* ============================================================
   WeekendGo · 那我走 — Philippines 3D Hiking Map
   MapLibre GL JS v5 · AWS Terrain Tiles · Esri World Imagery
   ============================================================ */
"use strict";

/* ---------- constants ---------- */
const HOME_VIEW = { center: [121.9, 11.8], zoom: 5.55, pitch: 42, bearing: -10 };
const INTRO_VIEW = { center: [121.9, 10.5], zoom: 4.1, pitch: 0, bearing: 0 };
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
let orbiting = false;
let orbitPrevTs = 0;
const filters = { q: "", region: "all", diff: "all" };
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    minZoom: 3.5,
    maxZoom: 16.4,
    maxPitch: 80,
    hash: false,
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
          maxzoom: 14,
          attribution: "Terrain: Mapzen/AWS Open Data",
        },
        hills: {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 14,
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
  map.on("dragstart", stopOrbit);
  map.on("wheel", stopOrbit);
  map.on("error", (e) => console.warn("[map]", e && e.error && e.error.message));

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
    map.setBearing(map.getBearing() + dt * 0.004);
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
function renderList(vis) {
  const body = $("#list-body");
  $("#list-count").textContent = vis.length;
  if (!vis.length) {
    body.innerHTML = `<div class="list-empty">${esc(t("list.empty")).replace(/\n/g, "<br>")}</div>`;
    return;
  }
  const sorted = [...vis].sort((a, b) => b.elevation_m - a.elevation_m);
  body.innerHTML = sorted.map((m, i) => `
    <button class="m-card ${m.id === activeId ? "active" : ""}" data-id="${esc(m.id)}" style="--i:${Math.min(i, 20)}">
      <div class="m-card-bar" style="background:${diffColor(m.difficulty)}"></div>
      <div class="m-card-main">
        <div class="m-card-name">${esc(loc(m.name))}</div>
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
}

function openDetail() { $("#detail").classList.add("open"); $("#detail").setAttribute("aria-hidden", "false"); }
function closeDetail() {
  $("#detail").classList.remove("open");
  $("#detail").setAttribute("aria-hidden", "true");
  setActivePeak(null);
  stopOrbit();
  highlightActiveCard();
}

/* ============================================================
   SELECTION & CAMERA
   ============================================================ */
function flyToMountain(m) {
  stopOrbit();
  map.flyTo({
    center: m.coords,
    zoom: 12.4,
    pitch: 66,
    bearing: (map.getBearing() + 45) % 360,
    duration: prefersReducedMotion ? 0 : 3000,
    essential: true,
  });
  map.once("moveend", () => { if (activeId === m.id) startOrbit(); });
}

function selectMountain(id) {
  const m = mountains.find((x) => x.id === id);
  if (!m) return;
  setActivePeak(id);
  renderDetail(m);
  openDetail();
  highlightActiveCard();
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

/* ---------- events ---------- */
function bindUI() {
  $("#hero-cta").addEventListener("click", dismissHero);

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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
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
      if (m) renderDetail(m);
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
  map.flyTo({ ...HOME_VIEW, duration: prefersReducedMotion ? 0 : 5000, essential: true, curve: 1.28 });
  setTimeout(() => { hero.remove(); }, 1200);
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

  try {
    const res = await fetch("data/mountains.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mountains = data.mountains || [];
  } catch (err) {
    console.error("[data]", err);
    toast(t("toast.loadFail"), 6000);
    return;
  }

  populateRegionSelect();
  fillHeroStats();
  renderList(visibleMountains());

  await mapReady;
  buildPeakLayers();
  applyFilters();

  // deep links: ?m=<mountain-id> jumps straight to a mountain; ?nohero=1 skips the intro
  const qp = new URLSearchParams(location.search);
  if (qp.has("m") || qp.has("nohero")) {
    const hero = $("#hero");
    if (hero) hero.remove();
    revealUI();
    const target = mountains.find((x) => x.id === qp.get("m"));
    if (target) {
      map.jumpTo({ center: target.coords, zoom: 12.4, pitch: 66, bearing: 35 });
      setActivePeak(target.id);
      renderDetail(target);
      openDetail();
      highlightActiveCard();
    } else {
      map.jumpTo(HOME_VIEW);
    }
  }
})();
