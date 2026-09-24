/* ============================================================
   print3d.js — "3D 打印纪念模型" dialog (lazy-loaded ES module)
   Real terrain (AWS Terrarium DEM) -> relief.js mesh -> three.js preview -> 3MF download.
   app.js calls openPrint3d(ctx) with { m, routes, active, hasTrail, t, loc, toast }.
   ============================================================ */
import * as THREE from "../vendor/three/three.module.js";
import { planTiles, demSampler, defaultHalfM, toLocal, buildRelief, build3MF, parseFont, DEM_URL } from "./relief.js";

const SIZES = [80, 100, 120, 150, 180];
const FILAMENTS = [
  { id: "stone", hex: "#E8E4DA" }, { id: "grey", hex: "#6B7280" }, { id: "black", hex: "#1F1F22" },
  { id: "forest", hex: "#3F6B3A" }, { id: "sand", hex: "#B08A5E" }, { id: "orange", hex: "#F97316" },
  { id: "red", hex: "#DC2626" }, { id: "blue", hex: "#2563EB" }, { id: "gold", hex: "#D4A017" },
];
const PARTS = ["terrain", "label", "trail"];

let ctx = null;          // current open context from app.js
let st = null;           // current options
let el = null;           // dialog root
let view = null;         // three.js state
let result = null;       // last buildRelief() result
let genToken = 0;
let genTimer = null;
const tiles = new Map(); // "z/x/y" -> Promise<{data, ch, size}>
let fontP = null;
const trailFiles = {};

const T = (k) => ctx.t("p3." + k);
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n).toLocaleString("en-US");

/* ---------------------------------------------------------------- data */
function loadFont() {
  fontP ??= fetch(new URL("../assets/fonts/Anton-Regular.ttf", import.meta.url))
    .then((r) => { if (!r.ok) throw new Error("font " + r.status); return r.arrayBuffer(); })
    .then(parseFont)
    .catch((e) => { fontP = null; throw e; });
  return fontP;
}

function loadTile({ z, x, y }) {
  const k = `${z}/${x}/${y}`;
  if (!tiles.has(k)) {
    tiles.set(k, (async () => {
      const r = await fetch(DEM_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y));
      if (!r.ok) throw new Error("dem " + r.status);
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256)
        : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      return { data: g.getImageData(0, 0, 256, 256).data, ch: 4, size: 256 };
    })().catch((e) => { tiles.delete(k); throw e; }));
  }
  return tiles.get(k);
}

async function loadRoutes() {
  if (ctx.routes && ctx.routes.length) return ctx.routes;
  if (!ctx.hasTrail) return [];
  const id = ctx.m.id;
  if (!trailFiles[id]) {
    trailFiles[id] = fetch(`data/trails/${id}.json`).then((r) => (r.ok ? r.json() : { routes: [] }))
      .then((d) => (d.routes || []).filter((r) => r.line && r.line.length > 1))
      .catch(() => []);
  }
  const routes = await trailFiles[id];
  ctx.routes = routes;
  const own = routes.findIndex((r) => r.source === "weekendgo"), main = routes.findIndex((r) => r.main);
  ctx.active = own >= 0 ? own : main >= 0 ? main : 0;
  return routes;
}

/* default ground half-width: by elevation, stretched (a little) to take in the chosen route */
function defaultHalfKm(routes, active) {
  const m = ctx.m, base = defaultHalfM(m.elevation_m);
  let far = 0;
  const r = routes[active];
  if (r) for (const [lng, lat] of r.line) {
    const [x, y] = toLocal(lng, lat, m.coords[0], m.coords[1]);
    far = Math.max(far, Math.abs(x), Math.abs(y));
  }
  const want = Math.min(Math.max(base, far * 1.1), base * 1.6);
  return Math.round(want / 500) / 2;                                // 0.5 km steps
}

/* ---------------------------------------------------------------- dialog */
function buildDialog() {
  el = document.createElement("div");
  el.id = "p3-modal";
  el.className = "p3-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="p3-scrim" data-close></div>
    <div class="p3-card glass" role="dialog" aria-modal="true" aria-labelledby="p3-title">
      <header class="p3-head">
        <div class="p3-titles">
          <div class="p3-kicker" data-t="kicker"></div>
          <h2 id="p3-title"></h2>
        </div>
        <button class="icon-btn p3-close" data-close aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="p3-body">
        <div class="p3-stage">
          <canvas class="p3-canvas"></canvas>
          <div class="p3-busy" hidden><span class="p3-spin"></span><span class="p3-msg"></span></div>
          <div class="p3-hint" data-t="hint"></div>
        </div>
        <div class="p3-form">
          <div class="p3-field"><div class="p3-lbl" data-t="shape"></div>
            <div class="p3-seg" data-k="shape"><button data-v="round" data-t="round"></button><button data-v="square" data-t="square"></button></div></div>
          <div class="p3-field"><div class="p3-lbl" data-t="size"></div>
            <div class="p3-seg" data-k="size">${SIZES.map((s) => `<button data-v="${s}">${s}</button>`).join("")}</div></div>
          <div class="p3-field"><div class="p3-lbl"><span data-t="range"></span><b data-out="halfKm"></b></div>
            <input type="range" data-k="halfKm" min="1" max="10" step="0.5"></div>
          <div class="p3-field"><div class="p3-lbl"><span data-t="exag"></span><b data-out="exag"></b></div>
            <input type="range" data-k="exag" min="1" max="3" step="0.1"></div>
          <div class="p3-field"><div class="p3-lbl"><span data-t="base"></span><b data-out="base"></b></div>
            <input type="range" data-k="base" min="8" max="20" step="1"></div>
          <div class="p3-field"><div class="p3-lbl" data-t="label"></div>
            <input type="text" class="p3-text" data-k="label" maxlength="36" spellcheck="false" autocomplete="off"></div>
          <div class="p3-field p3-trail-field"><div class="p3-lbl" data-t="trail"></div>
            <div class="p3-seg" data-k="trail"><button data-v="none" data-t="trailNone"></button><button data-v="active" data-t="trailActive"></button><button data-v="all" data-t="trailAll"></button></div></div>
          <div class="p3-field"><div class="p3-lbl" data-t="colors"></div>
            <div class="p3-colors">${PARTS.map((p) => `
              <div class="p3-crow" data-part="${p}"><span class="p3-cname" data-t="part.${p}"></span>
                <div class="p3-sw">${FILAMENTS.map((f) => `<button data-c="${f.hex}" style="--c:${f.hex}" data-tt="fil.${f.id}"></button>`).join("")}</div></div>`).join("")}
            </div></div>
          <div class="p3-stats"></div>
          <button class="d-btn d-btn-primary p3-dl" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>
            <span data-t="download"></span>
          </button>
          <p class="p3-note" data-t="note"></p>
          <p class="p3-credit" data-t="credit"></p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { close(); return; }
    const seg = e.target.closest(".p3-seg button");
    if (seg) {
      const k = seg.parentElement.dataset.k;
      st[k] = k === "size" ? +seg.dataset.v : seg.dataset.v;
      sync(); schedule(0);
      return;
    }
    const sw = e.target.closest(".p3-sw button");
    if (sw) {
      st.colors[sw.closest(".p3-crow").dataset.part] = sw.dataset.c;
      sync(); recolor();
    }
  });
  el.querySelectorAll("input[type=range]").forEach((inp) => inp.addEventListener("input", () => {
    st[inp.dataset.k] = +inp.value;
    sync(); schedule(inp.dataset.k === "halfKm" ? 350 : 180);
  }));
  const txt = el.querySelector(".p3-text");
  txt.addEventListener("input", () => { st.label = txt.value; schedule(350); });
  el.querySelector(".p3-dl").addEventListener("click", download);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el && !el.hidden) close(); });
  document.addEventListener("wg:langchange", () => { if (el && !el.hidden) { texts(); sync(); if (result) stats(result); } });
}

function texts() {
  el.querySelectorAll("[data-t]").forEach((n) => { n.textContent = T(n.dataset.t); });
  el.querySelectorAll("[data-tt]").forEach((n) => { n.title = T(n.dataset.tt); n.setAttribute("aria-label", n.title); });
  const m = ctx.m;
  const local = ctx.loc(m.name);
  el.querySelector("#p3-title").innerHTML = escH(local) + (local !== m.name.en ? ` <small>${escH(m.name.en)}</small>` : "");
}

/* reflect state into the controls */
function sync() {
  el.querySelectorAll(".p3-seg").forEach((seg) => {
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(st[seg.dataset.k]) === b.dataset.v));
  });
  el.querySelectorAll("input[type=range]").forEach((inp) => { inp.value = st[inp.dataset.k]; });
  el.querySelector('[data-out="halfKm"]').textContent = `${(st.halfKm * 2).toFixed(1)} km`;
  el.querySelector('[data-out="exag"]').textContent = `${st.exag.toFixed(1)}×`;
  el.querySelector('[data-out="base"]').textContent = `${st.base} mm`;
  const txt = el.querySelector(".p3-text");
  if (txt.value !== st.label) txt.value = st.label;
  el.querySelectorAll(".p3-crow").forEach((row) => {
    row.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.c === st.colors[row.dataset.part]));
  });
  const hasRoutes = (ctx.routes || []).length > 0;
  el.querySelector(".p3-trail-field").hidden = !hasRoutes;
  el.querySelector('.p3-crow[data-part="trail"]').hidden = !hasRoutes || st.trail === "none";
}

function busy(msg) {
  const b = el.querySelector(".p3-busy");
  b.hidden = !msg;
  if (msg) b.querySelector(".p3-msg").textContent = msg;
}

/* ---------------------------------------------------------------- generate */
function schedule(ms) {
  clearTimeout(genTimer);
  el.querySelector(".p3-dl").disabled = true;
  genTimer = setTimeout(generate, ms);
}

async function generate() {
  const token = ++genToken;
  const m = ctx.m, o = { ...st, colors: { ...st.colors } };
  const [lng0, lat0] = m.coords;
  const halfM = o.halfKm * 1000;
  const cell = Math.max(0.5, o.size / 240);
  try {
    busy(T("loading"));
    const plan = planTiles(lng0, lat0, halfM, cell * halfM / (o.size / 2));
    const [font, datas] = await Promise.all([loadFont(), Promise.all(plan.tiles.map(loadTile))]);
    if (token !== genToken) return;
    busy(T("building"));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // let the spinner paint
    if (token !== genToken) return;
    const tmap = new Map(plan.tiles.map((t, i) => [t.x + "/" + t.y, datas[i]]));
    const routes = ctx.routes || [];
    const pick = o.trail === "all" ? routes : o.trail === "active" && routes[ctx.active] ? [routes[ctx.active]] : [];
    result = buildRelief({
      heightAt: demSampler(plan.z, tmap, lng0, lat0), halfM, shape: o.shape, sizeMM: o.size,
      exag: o.exag, baseMM: o.base, cellMM: cell, label: o.label, font,
      trails: pick.map((r) => r.line.map(([lng, lat]) => toLocal(lng, lat, lng0, lat0))),
      colors: o.colors,
    });
    result.opts = o;
    showModel(result);
    stats(result);
    busy(null);
    el.querySelector(".p3-dl").disabled = false;
  } catch (e) {
    if (token !== genToken) return;
    console.error(e);
    busy(T("failed"));
  }
}

function stats(res) {
  const s = res.stats;
  const w = s.sizeMM, dims = `${w} × ${w} × ${Math.round(s.heightMM)} mm`;
  el.querySelector(".p3-stats").innerHTML = `
    <div><span>${escH(T("st.dims"))}</span><b>${dims}</b></div>
    <div><span>${escH(T("st.scale"))}</span><b>1 : ${fmt(Math.round(s.scale / 500) * 500)}</b></div>
    <div><span>${escH(T("st.relief"))}</span><b>${fmt(s.hmin)} – ${fmt(s.hmax)} m</b></div>
    <div><span>${escH(T("st.parts"))}</span><b>${res.parts.length} · ${fmt(Math.round(s.tris / 1000))}k ▲</b></div>
    ${res.warnings.includes("label-small") ? `<div class="p3-warn">${escH(T("st.small"))}</div>` : ""}`;
}

/* ---------------------------------------------------------------- three.js preview */
function initView() {
  const canvas = el.querySelector(".p3-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x3a4150, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-120, 220, -160);                  // from the north-west, like a relief map
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffe2c4, 0.55);
  fill.position.set(160, 60, 140);
  scene.add(fill);
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;                     // model z-up -> three y-up
  scene.add(group);
  const plate = new THREE.Mesh(new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  plate.rotation.x = -Math.PI / 2;
  scene.add(plate);

  view = { renderer, scene, camera, group, plate, meshes: [], az: -0.55, el: 0.62, dist: 300, radius: 60,
    auto: true, raf: 0, dirty: true, drag: null };

  canvas.addEventListener("pointerdown", (e) => {
    view.drag = { x: e.clientX, y: e.clientY, az: view.az, el: view.el };
    view.auto = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!view.drag) return;
    view.az = view.drag.az - (e.clientX - view.drag.x) * 0.008;
    view.el = Math.min(1.45, Math.max(0.08, view.drag.el + (e.clientY - view.drag.y) * 0.006));
    view.dirty = true;
  });
  const end = () => { view.drag = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.auto = false;
    view.dist = Math.min(view.radius * 9, Math.max(view.radius * 1.6, view.dist * Math.exp(e.deltaY * 0.0012)));
    view.dirty = true;
  }, { passive: false });
  new ResizeObserver(() => { view.dirty = true; }).observe(canvas);
}

function showModel(res) {
  const { group, meshes } = view;
  meshes.forEach((me) => { group.remove(me); me.geometry.dispose(); me.material.dispose(); });
  meshes.length = 0;
  const [cx, cy] = [128, 128];
  for (const p of res.parts) {
    const pos = new Float32Array(p.vertProperties);
    for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(p.triVerts, 1));
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.82, metalness: 0.0, flatShading: true });
    const me = new THREE.Mesh(g, mat);
    me.userData.part = p.name.toLowerCase();
    group.add(me);
    meshes.push(me);
  }
  const s = res.stats, r = s.sizeMM / 2;
  view.radius = Math.hypot(s.shape === "square" ? r * Math.SQRT2 : r, s.heightMM / 2);
  view.plate.scale.setScalar(r * (s.shape === "square" ? 1.5 : 1.15));
  view.plate.position.y = -0.05;
  if (!view.sized) { view.dist = view.radius * 4.3; view.sized = true; }   // keep the user's zoom afterwards
  view.dirty = true;
}

function recolor() {
  if (!view) return;
  for (const me of view.meshes) {
    const c = st.colors[me.userData.part];
    if (c) me.material.color.set(c);
  }
  if (result) for (const p of result.parts) { const c = st.colors[p.name.toLowerCase()]; if (c) p.color = c; }
  view.dirty = true;
}

function loop(ts) {
  if (!el || el.hidden) { view.raf = 0; return; }
  view.raf = requestAnimationFrame(loop);
  const cv = view.renderer.domElement;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * view.renderer.getPixelRatio()) || cv.height !== Math.round(h * view.renderer.getPixelRatio())) {
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / Math.max(1, h);
    view.camera.updateProjectionMatrix();
    view.dirty = true;
  }
  if (view.auto) { view.az += 0.0035; view.dirty = true; }
  if (!view.dirty) return;
  view.dirty = false;
  const s = result ? result.stats : { heightMM: 20 };
  const ty = s.heightMM * 0.38;
  const { camera, dist, az, el: elev } = view;
  camera.position.set(Math.sin(az) * Math.cos(elev) * dist, ty + Math.sin(elev) * dist, Math.cos(az) * Math.cos(elev) * dist);
  camera.lookAt(0, ty, 0);
  view.renderer.render(view.scene, camera);
}

/* ---------------------------------------------------------------- download */
function download() {
  if (!result) return;
  const m = ctx.m, o = result.opts;
  const bytes = build3MF(result.parts.map((p) => ({ ...p, color: st.colors[p.name.toLowerCase()] || p.color })), {
    title: `${m.name.en} — WeekendGo relief`,
    designer: "WeekendGo · 那我走",
    description: `${m.name.en} (${m.elevation_m} m). ${o.shape} ${o.size} mm, ${(o.halfKm * 2).toFixed(1)} km ground, `
      + `vertical ×${o.exag}. Terrain: AWS Terrain Tiles (SRTM et al.). Trails: © OpenStreetMap contributors (ODbL).`,
  });
  const blob = new Blob([bytes], { type: "model/3mf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `WeekendGo_${m.name.en.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}_${o.shape}_${o.size}mm.3mf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (ctx.toast) ctx.toast(T("saved"));
}

/* ---------------------------------------------------------------- open / close */
function close() {
  if (!el) return;
  el.hidden = true;
  document.body.classList.remove("modal-open");
  genToken++;
  clearTimeout(genTimer);
}

export async function openPrint3d(c) {
  ctx = c;
  if (!el) buildDialog();
  if (!view) initView();
  const routes = await loadRoutes().catch(() => []);
  const prev = st && st.id === c.m.id ? st : null;
  st = prev || {
    id: c.m.id, shape: "round", size: 120, exag: 1.5, base: 12,
    halfKm: defaultHalfKm(routes, ctx.active || 0),
    label: c.m.name.en.toUpperCase(),
    trail: routes.length ? "active" : "none",
    colors: { terrain: "#E8E4DA", label: "#1F1F22", trail: "#F97316" },
  };
  if (!prev) { result = null; view.sized = false; view.auto = true; view.az = -0.55; view.el = 0.62; }
  texts();
  sync();
  el.hidden = false;
  document.body.classList.add("modal-open");
  if (!view.raf) view.raf = requestAnimationFrame(loop);
  view.dirty = true;
  schedule(0);
}
