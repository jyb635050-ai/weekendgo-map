/* ============================================================
   WeekendGo · 那我走 — i18n dictionary (zh / en)
   ============================================================ */
"use strict";

const I18N = {
  zh: {
    "hero.badge": "菲律宾国家徒步地图",
    "hero.tagline": "从科迪勒拉云海到棉兰老之巅，探索菲律宾群岛的每一条山脊。",
    "hero.statMountains": "座山峰",
    "hero.statRegions": "个地区",
    "hero.statHighest": "最高海拔 (m)",
    "hero.cta": "开始探索",
    "hero.hint": "右键拖动旋转 · 滚轮缩放 · 点击山峰查看攻略",

    "brand.zh": "那我走 · 菲律宾徒步团",
    "search.placeholder": "搜索山峰…",
    "search.empty": "没有找到匹配的山峰",
    "photo.prev": "上一张照片",
    "photo.next": "下一张照片",

    "filter.allRegions": "全部地区",
    "filter.diffAll": "全部",
    "filter.diffEasy": "休闲 1–3",
    "filter.diffMid": "进阶 4–6",
    "filter.diffHard": "挑战 7–9",

    "list.title": "山峰列表",
    "list.empty": "当前筛选条件下没有山峰。\n试试调整地区或难度。",

    "region.cordillera": "科迪勒拉",
    "region.ilocos": "伊罗戈 / 北吕宋",
    "region.central-luzon": "中吕宋",
    "region.calabarzon": "南他加禄",
    "region.bicol": "比科尔",
    "region.visayas": "米沙鄢",
    "region.mindanao": "棉兰老",
    "region.islands": "离岛",

    "diff.label": "难度",
    "diff.1": "极易", "diff.2": "轻松", "diff.3": "休闲",
    "diff.4": "中等", "diff.5": "中上", "diff.6": "较难",
    "diff.7": "困难", "diff.8": "很难", "diff.9": "极难",
    "type.major": "多日 Major",
    "type.minor": "一日 Minor",
    "trailClass": "步道等级",

    "d.elevation": "海拔",
    "d.timeToSummit": "登顶耗时",
    "d.duration": "建议时长",
    "d.summary": "路线概述",
    "d.highlights": "亮点",
    "d.info": "实用信息",
    "d.jumpoff": "登山口",
    "d.season": "最佳季节",
    "d.province": "所在省份",
    "d.tips": "建议与提示",
    "d.sources": "资料来源",
    "d.gmaps": "地图导航",
    "d.flyto": "飞到这里",
    "d.share": "分享",
    "d.unverified": "部分数据待实地核实，出行前请以当地登记处 / 向导的最新信息为准。",
    "status.closed": "禁止徒步",
    "status.caution": "限制 · 需核实",
    "status.info": "需预约",
    "d.km": "公里",
    "d.tbc": "待确认",

    "hud.orbit": "环绕视角",
    "hud.home": "全国视角",

    "legend.easy": "休闲 1–3",
    "legend.mid": "进阶 4–6",
    "legend.hard": "挑战 7–8",
    "legend.extreme": "极限 9",

    "toast.orbitOn": "环绕模式已开启 — 拖动地图可退出",
    "toast.loadFail": "山峰数据加载失败，请刷新重试",
    "toast.linkCopied": "链接已复制，去粘贴给朋友吧",

    "wx.title": "天气预报 · 按峰顶海拔",
    "wx.today": "今天", "wx.tomorrow": "明天", "wx.day2": "后天",
    "wx.fail": "天气暂不可用",
    "wx.sun": "晴", "wx.psun": "多云间晴", "wx.cloud": "阴",
    "wx.fog": "雾", "wx.drizzle": "毛毛雨", "wx.rain": "雨",
    "wx.shower": "阵雨", "wx.snow": "雪", "wx.storm": "雷暴",

    "d.trail": "轨迹与海拔剖面",
    "d.trailOneWay": "单程",
    "d.trailAscent": "累计爬升",
    "d.trailNote": "轨迹来自 OpenStreetMap 社区数据，仅供参考；请以实地路标与向导为准。",
    "rt.count": "{n} 条路线 · 点击切换",
    "rt.main": "主线",
    "rt.src.osm-route": "OSM 路线",
    "rt.src.osm-named": "OSM 步道",
    "rt.src.osm-derived": "推算",
    "rt.src.weekendgo": "那我走实测",
    "rt.stale": "该路线 OSM 数据最后更新于 {d}（已超过 5 年），现场可能已有变化，请以当地向导为准。",
    "rt.gpx": "下载 GPX",
    "rt.gpxHint": "可导入两步路、Gaia GPS、Garmin 等导航 App",
    "rt.ownNote": "这条是那我走队员实地录制的 GPS 轨迹——最新、最贴近真实走法。",
    "p3.cta": "3D 打印纪念模型",
    "p3.ctaSub": "真实地形 · 底座刻山名和海拔 · 导出 3MF",
    "p3.kicker": "3D 打印纪念模型",
    "p3.hint": "拖动旋转 · 滚轮缩放",
    "p3.shape": "形状",
    "p3.round": "圆形",
    "p3.square": "方形",
    "p3.size": "直径 / 边长（mm）",
    "p3.range": "地面范围",
    "p3.exag": "垂直夸张",
    "p3.base": "底座高度",
    "p3.label": "底座文字",
    "p3.texts": "底座文字（可分别开关）",
    "p3.nameFront": "正面：山名",
    "p3.elevBack": "背面：最高海拔",
    "p3.custom": "自定义颜色",
    "p3.trail": "登山路线（凸起）",
    "p3.trailNone": "不加",
    "p3.trailActive": "当前路线",
    "p3.trailAll": "全部路线",
    "p3.colors": "配色（多色打印时各部件用的耗材）",
    "p3.part.base": "底座",
    "p3.part.terrain": "山体",
    "p3.part.label": "文字",
    "p3.part.trail": "路线",
    "p3.fil.stone": "石白", "p3.fil.grey": "灰", "p3.fil.black": "黑", "p3.fil.forest": "森林绿", "p3.fil.sand": "沙棕",
    "p3.fil.orange": "橙", "p3.fil.red": "红", "p3.fil.blue": "蓝", "p3.fil.gold": "金",
    "p3.st.dims": "尺寸",
    "p3.st.scale": "水平比例",
    "p3.st.relief": "海拔范围",
    "p3.st.parts": "部件 · 面数",
    "p3.st.small": "文字偏小，建议缩短文字或加大尺寸",
    "p3.download": "下载 3MF",
    "p3.note": "3MF 里是一个模型、最多四个部件（底座 / 山体 / 文字 / 路线），同色的部件共用一个耗材槽；Bambu Studio、OrcaSlicer 打开即按颜色分好，单色打印直接切片。建议 0.2 mm 层高，平放打印，无需支撑。",
    "p3.credit": "地形：AWS Terrain Tiles（SRTM 等）· 路线：© OpenStreetMap 贡献者 · 仅供纪念打印",
    "p3.loading": "下载地形数据…",
    "p3.building": "生成模型…",
    "p3.failed": "地形数据加载失败，请检查网络后重试",
    "p3.saved": "3MF 已下载，用切片软件打开即可打印",
    "p3.loadFail": "3D 模块加载失败，请刷新页面重试",

    "join.btn": "加入我们",
    "join.title": "加入我们的徒步活动",
    "join.desc": "微信扫码添加领队 Eddy，备注「徒步」，拉你进活动群。",
    "join.wechat": "微信：Weekend Go_ Eddy",
    "join.note": "那我走 · 每周末出发 🇵🇭",
    "join.qrSoon": "二维码整理中——先按上方微信号搜索添加",

    "mark.want": "想去",
    "mark.done": "已登顶",
    "mark.all": "全部",
    "mark.deviceNote": "记录仅保存在本机浏览器",
    "mark.progress": "已登顶",

    "sort.elevation": "海拔",
    "sort.difficulty": "难度",
    "sort.name": "名称",
    "sort.label": "排序",
  },

  en: {
    "hero.badge": "PHILIPPINES NATIONAL HIKING MAP",
    "hero.tagline": "From the cloud seas of the Cordillera to the summits of Mindanao — explore every ridge of the Philippine archipelago.",
    "hero.statMountains": "Mountains",
    "hero.statRegions": "Regions",
    "hero.statHighest": "Highest peak (m)",
    "hero.cta": "Start Exploring",
    "hero.hint": "Right-drag to rotate · Scroll to zoom · Click a peak for its guide",

    "brand.zh": "Philippines Hiking Group",
    "search.placeholder": "Search mountains…",
    "search.empty": "No mountains match your search",
    "photo.prev": "Previous photo",
    "photo.next": "Next photo",

    "filter.allRegions": "All regions",
    "filter.diffAll": "All",
    "filter.diffEasy": "Easy 1–3",
    "filter.diffMid": "Moderate 4–6",
    "filter.diffHard": "Hard 7–9",

    "list.title": "Mountains",
    "list.empty": "No mountains match the current filters.\nTry adjusting region or difficulty.",

    "region.cordillera": "Cordillera",
    "region.ilocos": "Ilocos / North Luzon",
    "region.central-luzon": "Central Luzon",
    "region.calabarzon": "CALABARZON",
    "region.bicol": "Bicol",
    "region.visayas": "Visayas",
    "region.mindanao": "Mindanao",
    "region.islands": "Islands",

    "diff.label": "Difficulty",
    "diff.1": "Very easy", "diff.2": "Easy", "diff.3": "Leisurely",
    "diff.4": "Moderate", "diff.5": "Mod-hard", "diff.6": "Challenging",
    "diff.7": "Difficult", "diff.8": "Very hard", "diff.9": "Extreme",
    "type.major": "Major climb",
    "type.minor": "Minor / dayhike",
    "trailClass": "Trail class",

    "d.elevation": "Elevation",
    "d.timeToSummit": "To summit",
    "d.duration": "Duration",
    "d.summary": "Route overview",
    "d.highlights": "Highlights",
    "d.info": "Practical info",
    "d.jumpoff": "Jump-off",
    "d.season": "Best season",
    "d.province": "Province",
    "d.tips": "Tips & advice",
    "d.sources": "Sources",
    "d.gmaps": "Maps",
    "d.flyto": "Fly here",
    "d.share": "Share",
    "d.unverified": "Some data pending field verification — always confirm with the local registration office / guides before your hike.",
    "status.closed": "CLOSED",
    "status.caution": "Restricted",
    "status.info": "Booking",
    "d.km": "km",
    "d.tbc": "TBC",

    "hud.orbit": "Orbit view",
    "hud.home": "National view",

    "legend.easy": "Easy 1–3",
    "legend.mid": "Moderate 4–6",
    "legend.hard": "Hard 7–8",
    "legend.extreme": "Extreme 9",

    "toast.orbitOn": "Orbit mode on — drag the map to exit",
    "toast.loadFail": "Failed to load mountain data — please refresh",
    "toast.linkCopied": "Link copied — share it with your friends",

    "wx.title": "Weather · at summit elevation",
    "wx.today": "Today", "wx.tomorrow": "Tomorrow", "wx.day2": "Day 3",
    "wx.fail": "Weather unavailable",
    "wx.sun": "Clear", "wx.psun": "Partly cloudy", "wx.cloud": "Overcast",
    "wx.fog": "Fog", "wx.drizzle": "Drizzle", "wx.rain": "Rain",
    "wx.shower": "Showers", "wx.snow": "Snow", "wx.storm": "Thunderstorm",

    "d.trail": "Trail & elevation",
    "d.trailOneWay": "one-way",
    "d.trailAscent": "ascent",
    "d.trailNote": "Trail from OpenStreetMap community data — for reference only; follow signage and local guides.",
    "rt.count": "{n} routes · tap to switch",
    "rt.main": "Main",
    "rt.src.osm-route": "OSM route",
    "rt.src.osm-named": "OSM trail",
    "rt.src.osm-derived": "Derived",
    "rt.src.weekendgo": "WeekendGo GPS",
    "rt.stale": "This route was last edited on OSM in {d} (5+ years ago) — the trail may have changed; confirm with local guides.",
    "rt.gpx": "Download GPX",
    "rt.gpxHint": "Import into Gaia GPS, Garmin, AllTrails and other navigation apps",
    "rt.ownNote": "Recorded on the ground by WeekendGo hikers — the freshest, most realistic line.",
    "p3.cta": "3D-print a keepsake model",
    "p3.ctaSub": "Real terrain · name & elevation on the base · 3MF export",
    "p3.kicker": "3D-printable keepsake",
    "p3.hint": "Drag to rotate · scroll to zoom",
    "p3.shape": "Shape",
    "p3.round": "Round",
    "p3.square": "Square",
    "p3.size": "Diameter / side (mm)",
    "p3.range": "Ground area",
    "p3.exag": "Vertical exaggeration",
    "p3.base": "Base height",
    "p3.label": "Base text",
    "p3.texts": "Base text (each can be turned off)",
    "p3.nameFront": "Front: mountain name",
    "p3.elevBack": "Back: summit elevation",
    "p3.custom": "Custom colour",
    "p3.trail": "Hiking route (raised)",
    "p3.trailNone": "None",
    "p3.trailActive": "Selected",
    "p3.trailAll": "All routes",
    "p3.colors": "Colours (filament per part for multi-colour prints)",
    "p3.part.base": "Base",
    "p3.part.terrain": "Terrain",
    "p3.part.label": "Text",
    "p3.part.trail": "Route",
    "p3.fil.stone": "Stone white", "p3.fil.grey": "Grey", "p3.fil.black": "Black", "p3.fil.forest": "Forest green", "p3.fil.sand": "Sand",
    "p3.fil.orange": "Orange", "p3.fil.red": "Red", "p3.fil.blue": "Blue", "p3.fil.gold": "Gold",
    "p3.st.dims": "Size",
    "p3.st.scale": "Horizontal scale",
    "p3.st.relief": "Elevation range",
    "p3.st.parts": "Parts · faces",
    "p3.st.small": "Text is small — shorten it or pick a bigger size",
    "p3.download": "Download 3MF",
    "p3.note": "The 3MF holds one model with up to four parts (base / terrain / text / route); parts with the same colour share a filament slot. Bambu Studio and OrcaSlicer open it with the colours already assigned; for a single colour just slice. 0.2 mm layers, print flat, no supports needed.",
    "p3.credit": "Terrain: AWS Terrain Tiles (SRTM et al.) · Routes: © OpenStreetMap contributors · For keepsake printing",
    "p3.loading": "Loading terrain…",
    "p3.building": "Building model…",
    "p3.failed": "Couldn't load terrain data — check your connection and try again",
    "p3.saved": "3MF downloaded — open it in your slicer to print",
    "p3.loadFail": "Couldn't load the 3D module — please refresh and try again",

    "join.btn": "Join us",
    "join.title": "Join our weekend hikes",
    "join.desc": "Scan the QR on WeChat to add our lead Eddy — mention \"hiking\" and he'll add you to the group.",
    "join.wechat": "WeChat: Weekend Go_ Eddy",
    "join.note": "WeekendGo · every weekend 🇵🇭",
    "join.qrSoon": "QR coming soon — search the WeChat ID above to add",

    "mark.want": "Want to go",
    "mark.done": "Climbed",
    "mark.all": "All",
    "mark.deviceNote": "Saved in this browser only",
    "mark.progress": "Climbed",

    "sort.elevation": "Elevation",
    "sort.difficulty": "Difficulty",
    "sort.name": "Name",
    "sort.label": "Sort",
  },
};

/* ---------- language state ---------- */
let LANG = localStorage.getItem("wg-lang") || "zh";
if (!I18N[LANG]) LANG = "zh";

function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) || I18N.zh[key] || key;
}

/** bilingual field accessor: {zh:"", en:""} -> current language string */
function loc(field) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  return field[LANG] || field.zh || field.en || "";
}

/** apply dictionary to all data-i18n / data-i18n-placeholder nodes */
function applyI18nDom() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  document.body.dataset.lang = LANG;
  const langBtn = document.getElementById("btn-lang");
  if (langBtn) langBtn.textContent = LANG === "zh" ? "EN" : "中";
  document.title = LANG === "zh"
    ? "WeekendGo · 那我走 — 菲律宾徒步 3D 地图"
    : "WeekendGo — Philippines 3D Hiking Map";
}

function setLang(lang) {
  LANG = I18N[lang] ? lang : "zh";
  localStorage.setItem("wg-lang", LANG);
  applyI18nDom();
  document.dispatchEvent(new CustomEvent("wg:langchange"));
}
