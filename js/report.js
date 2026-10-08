/* ============================================================
   report.js — "登顶战报" summit report card (lazy-loaded ES module)

   The card's signature is "my range": every mountain the hiker has
   marked as climbed becomes a peak in one continuous ridge, drawn to
   true altitude against a metre scale and coloured with topographic
   (hypsometric) tints, each summit carrying the same orange flag the
   map plants. Rendered on a canvas -> PNG (download / share / long-press).

   app.js calls openReport(ctx) with
   { mountains, marks, t, loc, lang, toast, showList }.
   ============================================================ */

const REGIONS = ["cordillera", "central-luzon", "calabarzon", "bicol", "visayas", "mindanao", "islands"];
const EVEREST = 8849;
const FORMATS = { post: [1080, 1350], story: [1080, 1920] };
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900"
  + "&family=Ma+Shan+Zheng&family=JetBrains+Mono:wght@500;700&display=swap";
const F = {
  num: '"Big Shoulders Display", Anton, Impact, sans-serif',
  brush: '"Ma Shan Zheng", "Noto Serif SC", serif',
  mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  sans: '"DM Sans", "Noto Sans SC", system-ui, sans-serif',
};

/* rank by number of summits: zh is set vertically in brush script */
const TIERS = [
  [70, "菲律宾之巅", "LEGEND OF THE ISLANDS"],
  [40, "群峰之主", "RANGE MASTER"],
  [20, "列岛登峰者", "ARCHIPELAGO CLIMBER"],
  [10, "群山收藏家", "SUMMIT COLLECTOR"],
  [5, "追峰人", "PEAK CHASER"],
  [2, "山野行者", "TRAIL WANDERER"],
  [1, "初登者", "FIRST SUMMIT"],
];

const THEMES = {
  dawn: {
    sky: ["#F4C9A8", "#EED9C6", "#E3E3DD"], ink: "#132A30", sub: "rgba(19,42,48,.62)", rule: "rgba(19,42,48,.16)",
    brush: "#D2462A", stars: false,
    tints: [[0, "#2D5A4C"], [300, "#46705A"], [800, "#76895A"], [1500, "#AE9764"], [2200, "#8A786A"], [2700, "#EFE8DC"]],
    far: "rgba(120,140,150,.55)", mist: "rgba(250,244,236,.75)",
    ground: "#10232A", groundInk: "#ECE6DC", groundSub: "rgba(236,230,220,.55)", accent: "#FF7A3D",
  },
  night: {
    sky: ["#070B18", "#121B36", "#27365C"], ink: "#EDE7DD", sub: "rgba(237,231,221,.6)", rule: "rgba(237,231,221,.13)",
    brush: "#FF6A3D", stars: true,
    tints: [[0, "#13302C"], [300, "#1D3D35"], [800, "#34503F"], [1500, "#5E5A45"], [2200, "#4E4650"], [2700, "#A9A6B4"]],
    far: "rgba(70,86,128,.55)", mist: "rgba(160,176,214,.30)",
    ground: "#05080F", groundInk: "#EDE7DD", groundSub: "rgba(237,231,221,.5)", accent: "#FF7A3D",
  },
};

let ctx = null, el = null, st = null, imgURL = null, lastBlob = null, renderToken = 0;
let fontsP = null, logoP = null;
const T = (k) => ctx.t("rp." + k);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

/* ---------------------------------------------------------------- assets */
let cssP = null;
function loadCss() {
  // the @font-face rules must be parsed before document.fonts.load() can find the faces;
  // calling it earlier resolves instantly with nothing and the card falls back to system fonts
  cssP ??= new Promise((res) => {
    const l = document.createElement("link");
    l.id = "rp-fonts"; l.rel = "stylesheet"; l.href = FONT_CSS;
    l.onload = () => res(true);
    l.onerror = () => res(false);
    document.head.appendChild(l);
  });
  return cssP;
}
async function loadFonts(sample) {
  const cssOk = await Promise.race([loadCss(), new Promise((r) => setTimeout(() => r(false), 8000))]);
  if (!cssOk) return false;
  const want = [
    document.fonts.load('900 120px "Big Shoulders Display"', "0123456789/,+"),
    document.fonts.load('800 40px "Big Shoulders Display"', "0123456789/,M"),
    document.fonts.load('100px "Ma Shan Zheng"', TIERS.map((x) => x[1]).join("")),
    document.fonts.load('700 18px "JetBrains Mono"', "SUMMIT REPORT 0123456789M"),
    document.fonts.load('500 18px "JetBrains Mono"', "abc"),
    document.fonts.load('700 30px "Noto Sans SC"', sample),
    document.fonts.load('700 30px "DM Sans"', "Climbed"),
  ];
  // never block the card on fonts for long: fall back to system faces after 12 s,
  // and redraw once they do arrive (see fontsReady)
  fontsP = Promise.allSettled(want);
  return Promise.race([fontsP.then(() => true), new Promise((r) => setTimeout(() => r(false), 12000))]);
}
function loadLogo() {
  logoP ??= new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = new URL("../assets/logo-mark.webp", import.meta.url).href;
  });
  return logoP;
}

/* ---------------------------------------------------------------- data */
function summary() {
  const done = ctx.mountains.filter((m) => ctx.marks[m.id] === "done");
  const byElev = [...done].sort((a, b) => b.elevation_m - a.elevation_m);
  const sum = done.reduce((s, m) => s + m.elevation_m, 0);
  const regions = new Set(done.map((m) => m.region_key));
  const hardest = done.reduce((a, m) => (!a || m.difficulty > a.difficulty ? m : a), null);
  const tier = TIERS.find(([n]) => done.length >= n) || TIERS[TIERS.length - 1];
  return { done, byElev, sum, regions, hardest, tier, total: ctx.mountains.length, highest: byElev[0] };
}

const shortName = (m, zh) => (zh ? m.name.zh.replace(/（.*?）|\(.*?\)/g, "")
  : m.name.en.replace(/^Mt\.?\s+|^Mount\s+/i, "").replace(/\s*\(.*?\)/g, "").toUpperCase());

/* seeded so the same set of mountains always draws the same ridge */
function rng(str) {
  let s = 2166136261;
  for (let i = 0; i < str.length; i++) s = Math.imul(s ^ str.charCodeAt(i), 16777619);
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- drawing */
/* A range profile: every summit is a broad massif whose top sits exactly at its altitude;
   neighbouring massifs merge (max of kernels), plus a little fractal roughness on the flanks.
   Wider massifs for taller mountains, so a 2,954 m giant doesn't read as a needle. */
function rangeProfile(peaks, x0, x1, R, opts = {}) {
  const n = peaks.length;
  const weights = peaks.map((p) => Math.pow(p.e, 0.62));
  const tot = weights.reduce((a, b) => a + b, 0);
  let x = x0;
  peaks.forEach((p, i) => {
    const w = (x1 - x0) * weights[i] / tot;
    p.x = x + w / 2 + (R() - 0.5) * w * 0.18;
    p.w = w * (opts.spread || 1.05);
    x += w;
  });
  // value noise
  const NOISE = Array.from({ length: 400 }, () => R() - 0.5);
  const noise = (t) => { const i = Math.floor(t), f = t - i, a = NOISE[((i % 400) + 400) % 400], b = NOISE[(((i + 1) % 400) + 400) % 400]; return a + (b - a) * (f * f * (3 - 2 * f)); };
  const fbm = (t) => noise(t) * 0.6 + noise(t * 2.3 + 17) * 0.28 + noise(t * 5.1 + 41) * 0.12;
  const STEP = 2, cols = [];
  for (let px = x0 - 40; px <= x1 + 40; px += STEP) {
    let h = 0, near = Infinity;
    for (const p of peaks) {
      const d = Math.abs(px - p.x) / (p.w * 0.62);
      h = Math.max(h, p.e * Math.exp(-Math.pow(d, 1.55)));
      near = Math.min(near, Math.abs(px - p.x) / (p.w * 0.12));
    }
    const rough = (opts.rough ?? 0.07) * Math.min(1, near) * h;
    cols.push([px, Math.max(0, h + fbm(px / 26) * rough * 2)]);
  }
  return cols;
}

function fillProfile(g, cols, yOf, baseY) {
  g.beginPath();
  g.moveTo(cols[0][0], baseY + 2);
  for (const [x, e] of cols) g.lineTo(x, yOf(e));
  g.lineTo(cols[cols.length - 1][0], baseY + 2);
  g.closePath();
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function drawFlag(g, x, y, s, color) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = "rgba(10,15,20,.75)"; g.lineWidth = 3.2 * s; g.lineCap = "round";
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -40 * s); g.stroke();
  g.strokeStyle = "#F7F3EC"; g.lineWidth = 1.6 * s;
  g.beginPath(); g.moveTo(0, -1); g.lineTo(0, -40 * s); g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(1 * s, -40 * s);
  g.bezierCurveTo(9 * s, -44 * s, 16 * s, -36 * s, 26 * s, -40 * s);
  g.lineTo(23 * s, -32 * s); g.lineTo(27 * s, -24 * s);
  g.bezierCurveTo(16 * s, -20 * s, 9 * s, -28 * s, 1 * s, -24 * s);
  g.closePath(); g.fill();
  g.restore();
}

function vertical(g, text, x, y, size, gap) {
  [...text].forEach((ch, i) => g.fillText(ch, x, y + i * (size + gap)));
}

function grain(g, W, H, alpha) {
  const R = rng("grain");
  g.save();
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(R() * W, R() * H, 1.4, 1.4);
  }
  g.restore();
}

async function render() {
  const token = ++renderToken;
  const S = summary();
  const zh = ctx.lang() === "zh";
  const [W, H] = FORMATS[st.format];
  const th = THEMES[st.theme];
  const story = st.format === "story";
  const names = S.byElev.slice(0, 24).map((m) => shortName(m, zh)).join("");
  const fontsOk = await loadFonts(names + S.tier[1] + T("countLabel") + T("everestMore") + T("everestLess") + "最高峰海拔合计走过地区最难度");
  if (!fontsOk && fontsP) fontsP.then(() => { if (el && !el.hidden && token === renderToken) rerender(); });
  const logo = await loadLogo();
  if (token !== renderToken) return;

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  if ("letterSpacing" in g) g.letterSpacing = "0px";
  const P = 72;
  const baseY = story ? 1430 : 1012;
  const ridgeTop = story ? 700 : 590;
  // headline geometry first, so peak names can steer around it
  const numY = story ? 500 : 420;
  const rankSize = story ? 118 : 104, rx = W - P - rankSize / 2, ry = story ? 250 : 210;
  const rankH = [...S.tier[1]].length * (rankSize - 6);
  S.blocked = [{ x0: rx - rankSize / 2 - 40, x1: W, y0: ry - 10, y1: ry + rankH + 10 }];
  S.labelTop = numY + 96;

  // sky
  const sky = g.createLinearGradient(0, 0, 0, baseY);
  sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.55, th.sky[1]); sky.addColorStop(1, th.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, baseY);
  if (th.stars) {
    const R = rng("stars" + st.format);
    for (let i = 0; i < 260; i++) {
      const y = R() * baseY * 0.8, r = R() < 0.92 ? 1 + R() * 1.2 : 2.2;
      g.fillStyle = `rgba(255,248,236,${0.25 + R() * 0.6})`;
      g.beginPath(); g.arc(R() * W, y, r, 0, Math.PI * 2); g.fill();
    }
  } else {
    const sun = g.createRadialGradient(W * 0.78, baseY * 0.62, 10, W * 0.78, baseY * 0.62, W * 0.55);
    sun.addColorStop(0, "rgba(255,190,140,.55)"); sun.addColorStop(1, "rgba(255,190,140,0)");
    g.fillStyle = sun; g.fillRect(0, 0, W, baseY);
  }

  // altitude scale: a hairline every 500 m, labelled at the left edge
  const topE = Math.max(1000, Math.ceil(((S.highest ? S.highest.elevation_m : 1000) + 250) / 500) * 500);
  const yOf = (e) => baseY - (e / topE) * (baseY - ridgeTop);
  g.font = `500 17px ${F.mono}`;
  g.textBaseline = "middle";
  for (let e = 500; e <= topE; e += 500) {
    const y = yOf(e);
    g.strokeStyle = th.rule; g.lineWidth = 1; g.setLineDash([2, 7]);
    g.beginPath(); g.moveTo(P + 74, y); g.lineTo(W - P, y); g.stroke();
    g.setLineDash([]);
    g.fillStyle = th.sub; g.textAlign = "left";
    g.fillText(`${fmt(e)} M`, P, y);
  }

  // far range (depth), then mist, then my range
  const peaks = S.byElev.slice(0, 24).map((m) => ({ m, e: m.elevation_m }));
  const order = [];                       // tallest a little right of centre, the rest alternating outwards
  const mid = Math.floor(peaks.length * 0.55);
  peaks.forEach((p, i) => { const k = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2); order[mid + k] = p; });
  const range = order.filter(Boolean);
  const seed = S.done.map((m) => m.id).sort().join(",") + st.format;
  if (range.length) {
    const farPeaks = range.map((p) => ({ e: p.e * 0.7 + 180 })).reverse();
    const far = rangeProfile(farPeaks, P - 60, W - P + 60, rng(seed + "far"), { spread: 1.3, rough: 0.05 });
    g.fillStyle = th.far; fillProfile(g, far, yOf, baseY); g.fill();

    g.save(); g.filter = "blur(26px)"; g.fillStyle = th.mist;
    const R = rng(seed + "mist");
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.ellipse(R() * W, baseY - (baseY - ridgeTop) * (0.1 + R() * 0.16), 160 + R() * 160, 24 + R() * 16, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    const cols = rangeProfile(range, P + 84, W - P + 10, rng(seed), { spread: 1.08, rough: 0.075 });
    g.save();
    fillProfile(g, cols, yOf, baseY); g.clip();
    th.tints.forEach(([e0, c], i) => {               // hypsometric tint: one colour per altitude band
      const e1 = i + 1 < th.tints.length ? th.tints[i + 1][0] : topE * 2;
      g.fillStyle = c;
      g.fillRect(0, yOf(e1), W, yOf(e0) - yOf(e1) + 1);
    });
    // light from the west: columns on east-facing slopes get darker in proportion to the slope
    const raw = cols.map((c, i) => (i ? (cols[i - 1][1] - c[1]) / (c[0] - cols[i - 1][0]) : 0));
    const sm = raw.map((_, i) => { let t = 0, n = 0; for (let k = -6; k <= 6; k++) { const v = raw[i + k]; if (v !== undefined) { t += v; n++; } } return t / n; });
    for (let i = 1; i < cols.length; i++) {
      const [x, e] = cols[i], slope = sm[i];
      const a = slope > 0 ? Math.min(0.34, slope * 0.06) : Math.max(-0.1, slope * 0.02);
      if (Math.abs(a) < 0.004) continue;
      // shading belongs to the slope face just under the ridge line, so it fades out downwards
      const y = yOf(e), gr = g.createLinearGradient(0, y, 0, y + 120);
      const c = a > 0 ? "0,0,0" : "255,248,235", al = Math.abs(a) * 1.3;
      gr.addColorStop(0, `rgba(${c},${al.toFixed(3)})`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr;
      g.fillRect(cols[i - 1][0], y, x - cols[i - 1][0], 120);
    }
    const fade = g.createLinearGradient(0, ridgeTop, 0, baseY);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,.32)");
    g.fillStyle = fade; g.fillRect(0, ridgeTop - 200, W, baseY - ridgeTop + 210);
    g.restore();
    g.strokeStyle = "rgba(255,250,240,.6)"; g.lineWidth = 1.5;
    g.beginPath(); cols.forEach(([x, e], i) => (i ? g.lineTo(x, yOf(e)) : g.moveTo(x, yOf(e)))); g.stroke();

    // flags on every summit
    for (const p of range) { p.y = yOf(p.e); drawFlag(g, p.x, p.y - 1, story ? 1.05 : 0.95, th.accent); }

    // names on the highest few: try stacked slots above the flag; skip if nothing fits
    const busy = [...(S.blocked || [])];
    for (const p of range) busy.push({ x0: p.x - 4, x1: p.x + 30, y0: p.y - 44, y1: p.y });   // flags
    let shown = 0;
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    for (const p of [...range].sort((a, b) => b.e - a.e)) {
      if (shown >= (story ? 8 : 6)) break;
      const name = shortName(p.m, zh);
      g.font = `700 ${zh ? 23 : 20}px ${zh ? F.sans : F.mono}`;
      const w = Math.max(g.measureText(name).width, 70) + 16;
      let box = null;
      for (let k = 0; k < 5 && !box; k++) {
        const yb = p.y - 52 - k * 58;                 // baseline of the elevation line
        const cand = { x0: p.x - w / 2, x1: p.x + w / 2, y0: yb - 46, y1: yb + 6 };
        if (cand.y0 < S.labelTop || cand.x0 < P + 70 || cand.x1 > W - 10) break;
        if (!busy.some((b) => overlaps(b, cand))) box = cand;
      }
      if (!box) continue;
      busy.push(box); shown++;
      const yb = box.y1 - 6;
      if (yb < p.y - 60) { g.strokeStyle = th.rule; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, p.y - 46); g.lineTo(p.x, yb + 6); g.stroke(); }
      g.fillStyle = th.ink; g.fillText(name, p.x, yb - 22);
      g.font = `500 16px ${F.mono}`; g.fillStyle = th.sub;
      g.fillText(`${fmt(p.e)} M`, p.x, yb);
    }
    if (S.done.length > range.length) {
      g.font = `500 16px ${F.mono}`; g.fillStyle = th.sub; g.textAlign = "right";
      g.fillText(T("more").replace("{n}", S.done.length - range.length), W - P, baseY - 18);
    }
  }

  // ground panel
  g.fillStyle = th.ground; g.fillRect(0, baseY, W, H - baseY);
  g.fillStyle = th.accent; g.fillRect(0, baseY, W, 3);

  // header
  g.textBaseline = "middle"; g.textAlign = "left";
  if (logo) {
    g.save();
    g.fillStyle = "#FFFFFF";
    g.beginPath(); g.roundRect(P, P - 4, 56, 56, 14); g.fill();
    g.drawImage(logo, P + 5, P + 1, 46, 46);
    g.restore();
  }
  g.fillStyle = th.ink; g.font = `700 22px ${F.mono}`;
  g.fillText("WEEKENDGO", P + 72, P + 12);
  g.font = `500 18px ${F.mono}`; g.fillStyle = th.sub;
  g.fillText(T("brandSub"), P + 72, P + 38);
  g.textAlign = "right"; g.font = `700 18px ${F.mono}`; g.fillStyle = th.ink;
  g.fillText(`SUMMIT REPORT · ${new Date().getFullYear()}`, W - P, P + 12);
  g.font = `500 17px ${F.mono}`; g.fillStyle = th.sub;
  g.fillText(T("reportZh"), W - P, P + 38);

  // the count
  const count = String(S.done.length);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.font = `900 ${story ? 380 : 320}px ${F.num}`;
  g.fillStyle = th.ink;
  g.fillText(count, P - 8, numY);
  const cw = g.measureText(count).width;
  g.font = `800 ${story ? 64 : 56}px ${F.num}`; g.fillStyle = th.sub;
  g.fillText(`/${S.total}`, P + cw + 6, numY);
  g.font = `700 ${zh ? 34 : 30}px ${F.sans}`; g.fillStyle = th.ink;
  g.fillText(T("countLabel"), P, numY + 62);

  // rank: vertical brush script down the right edge, English in mono beside it
  g.textAlign = "center"; g.textBaseline = "top";
  g.font = `${rankSize}px ${F.brush}`; g.fillStyle = th.brush;
  g.save(); g.shadowColor = "rgba(0,0,0,.18)"; g.shadowBlur = 8;
  vertical(g, S.tier[1], rx, ry, rankSize, -6);
  g.restore();
  g.save();
  g.translate(rx - rankSize / 2 - 26, ry);
  g.rotate(Math.PI / 2);
  g.textAlign = "left"; g.textBaseline = "middle";
  g.font = `700 18px ${F.mono}`; g.fillStyle = th.sub;
  g.fillText(S.tier[2], 0, 0);
  g.restore();

  // stats: four facts, hairline-separated
  const sy = baseY + (story ? 92 : 58);
  const cols = [
    [T("stHighest"), S.highest ? `${fmt(S.highest.elevation_m)} M` : "—", S.highest ? shortName(S.highest, zh) : ""],
    [T("stSum"), `${fmt(S.sum)} M`, T("stSumNote")],
    [T("stRegions"), `${S.regions.size}/${REGIONS.length}`, [...S.regions].slice(0, 3).map((r) => ctx.t("region." + r)).join(" · ")],
    [T("stHardest"), S.hardest ? `${S.hardest.difficulty}/9` : "—", S.hardest ? shortName(S.hardest, zh) : ""],
  ];
  const cwid = (W - 2 * P) / 4;
  cols.forEach(([lab, val, note], i) => {
    const x = P + i * cwid;
    if (i) { g.fillStyle = "rgba(255,255,255,.14)"; g.fillRect(x - 14, sy - 6, 1, 118); }
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = zh ? `600 17px ${F.sans}` : `500 16px ${F.mono}`; g.fillStyle = th.groundSub;
    g.fillText(lab, x, sy + 12);
    g.font = `800 50px ${F.num}`; g.fillStyle = th.groundInk;
    g.fillText(val, x, sy + 66);
    g.font = `500 ${zh ? 19 : 16}px ${zh ? F.sans : F.mono}`; g.fillStyle = th.groundSub;
    let n = note;
    while (n && g.measureText(n).width > cwid - 26) n = n.slice(0, -1);
    g.fillText(n !== note ? n.slice(0, -1) + "…" : n, x, sy + 100);
  });

  // the line that makes it feel like something: your summits stacked against Everest
  const ev = S.sum / EVEREST;
  const line = ev >= 1 ? T("everestMore").replace("{x}", ev.toFixed(1)) : T("everestLess").replace("{p}", Math.max(1, Math.round(ev * 100)));
  const ly = sy + (story ? 236 : 162);
  g.font = `700 ${zh ? 32 : 30}px ${F.sans}`; g.fillStyle = th.groundInk; g.textAlign = "left";
  g.fillText(line, P, ly);
  g.fillStyle = th.accent; g.fillRect(P, ly + 16, 64, 4);

  // footer
  const fy = H - (story ? 62 : 42);
  g.font = `500 17px ${F.mono}`; g.fillStyle = th.groundSub; g.textAlign = "left";
  const who = (st.name || "").trim();
  g.fillText((who ? `${who} · ` : "") + "jyb635050-ai.github.io/weekendgo-map", P, fy);
  g.textAlign = "right";
  const d = new Date();
  g.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} · WEEKEND GO, WE CAN GO!`, W - P, fy);

  grain(g, W, H, 0.035);

  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  if (token !== renderToken || !blob) return;
  lastBlob = blob;
  if (imgURL) URL.revokeObjectURL(imgURL);
  imgURL = URL.createObjectURL(blob);
  const img = el.querySelector(".rp-img");
  img.src = imgURL;
  el.querySelector(".rp-stage").style.setProperty("--ar", (W / H).toFixed(4));
  el.querySelector(".rp-busy").hidden = true;
}

/* ---------------------------------------------------------------- dialog */
function build() {
  el = document.createElement("div");
  el.className = "rp-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="rp-scrim" data-close></div>
    <div class="rp-card glass" role="dialog" aria-modal="true" aria-labelledby="rp-title">
      <button class="icon-btn rp-close" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="rp-stage">
        <img class="rp-img" alt="">
        <div class="rp-busy"><span class="p3-spin"></span></div>
      </div>
      <div class="rp-side">
        <div class="rp-kicker" data-t="kicker"></div>
        <h2 id="rp-title" data-t="title"></h2>
        <p class="rp-lead"></p>
        <div class="rp-field"><div class="rp-lbl" data-t="format"></div>
          <div class="p3-seg" data-k="format"><button data-v="post" data-t="fmtPost"></button><button data-v="story" data-t="fmtStory"></button></div></div>
        <div class="rp-field"><div class="rp-lbl" data-t="theme"></div>
          <div class="p3-seg" data-k="theme"><button data-v="dawn" data-t="thDawn"></button><button data-v="night" data-t="thNight"></button></div></div>
        <div class="rp-field"><div class="rp-lbl" data-t="name"></div>
          <input class="p3-text rp-name" maxlength="24" spellcheck="false" autocomplete="nickname"></div>
        <div class="rp-actions">
          <button class="d-btn d-btn-primary rp-dl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>
            <span data-t="download"></span></button>
          <button class="d-btn d-btn-ghost rp-share" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
            <span data-t="share"></span></button>
        </div>
        <p class="rp-hint" data-t="hint"></p>
        <button class="rp-list" data-t="viewList"></button>
      </div>
      <div class="rp-empty" hidden>
        <div class="rp-empty-flag"></div>
        <h2 data-t="emptyTitle"></h2>
        <p data-t="emptyBody"></p>
        <button class="d-btn d-btn-primary" data-close data-t="emptyCta"></button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { close(); return; }
    const b = e.target.closest(".p3-seg button");
    if (b) { st[b.parentElement.dataset.k] = b.dataset.v; save(); sync(); rerender(); }
  });
  const name = el.querySelector(".rp-name");
  let nt = null;
  name.addEventListener("input", () => { st.name = name.value; save(); clearTimeout(nt); nt = setTimeout(rerender, 400); });
  el.querySelector(".rp-dl").addEventListener("click", download);
  el.querySelector(".rp-share").addEventListener("click", share);
  el.querySelector(".rp-list").addEventListener("click", () => { close(); ctx.showList(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el && !el.hidden) close(); });
  document.addEventListener("wg:langchange", () => { if (el && !el.hidden) { texts(); rerender(); } });
}

function texts() {
  el.querySelectorAll("[data-t]").forEach((n) => { n.textContent = T(n.dataset.t); });
  el.querySelector(".rp-name").placeholder = T("namePh");
  const S = summary();
  el.querySelector(".rp-lead").textContent = T("lead").replace("{n}", S.done.length).replace("{t}", ctx.lang() === "zh" ? S.tier[1] : S.tier[2]);
  el.querySelector(".rp-img").alt = T("alt").replace("{n}", S.done.length);
}

function sync() {
  el.querySelectorAll(".p3-seg").forEach((seg) => seg.querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", st[seg.dataset.k] === b.dataset.v)));
  const n = el.querySelector(".rp-name");
  if (n.value !== st.name) n.value = st.name || "";
}

function save() { try { localStorage.setItem("wg-report", JSON.stringify(st)); } catch (e) { /* private mode */ } }

function rerender() {
  el.querySelector(".rp-busy").hidden = false;
  render().catch((e) => { console.error(e); el.querySelector(".rp-busy").hidden = true; ctx.toast(T("failed")); });
}

function fileName() { return `WeekendGo-summits-${summary().done.length}-${st.format}.png`; }

function download() {
  if (!lastBlob) return;
  const a = document.createElement("a");
  a.href = imgURL; a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  ctx.toast(T("saved"));
}

async function share() {
  if (!lastBlob) return;
  const file = new File([lastBlob], fileName(), { type: "image/png" });
  try {
    await navigator.share({ files: [file], title: T("title"), text: "Weekend Go, We Can Go! · WeekendGo 那我走" });
  } catch (e) { if (e && e.name !== "AbortError") ctx.toast(T("shareFail")); }
}

function close() {
  if (!el) return;
  el.hidden = true;
  document.body.classList.remove("modal-open");
  renderToken++;
}

export function openReport(c) {
  ctx = c;
  if (!el) build();
  if (!st) {
    try { st = JSON.parse(localStorage.getItem("wg-report") || "null"); } catch (e) { st = null; }
    st = { format: "post", theme: "dawn", name: "", ...(st || {}) };
    if (!FORMATS[st.format]) st.format = "post";
    if (!THEMES[st.theme]) st.theme = "dawn";
  }
  const S = summary();
  const card = el.querySelector(".rp-card");
  card.classList.toggle("is-empty", !S.done.length);
  el.querySelector(".rp-empty").hidden = !!S.done.length;
  texts(); sync();
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }));
  el.querySelector(".rp-share").hidden = !canShare;
  el.hidden = false;
  document.body.classList.add("modal-open");
  if (S.done.length) rerender();
}
