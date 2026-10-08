"""check_report.py — headless check of the summit report card: preset climbed marks, open the
dialog from the badge, save each format/theme PNG exactly as the page generated it.

    uv run --no-project --with playwright python tools/check_report.py [url] [outdir] [lang]
"""
import base64, os, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4321/"
out = sys.argv[2] if len(sys.argv) > 2 else "out/report"
lang = sys.argv[3] if len(sys.argv) > 3 else "zh"
os.makedirs(out, exist_ok=True)
MARKS = {"apo": "done", "pulag": "done", "batulao": "done", "pico-de-loro": "done", "maculot": "done", "makiling": "done",
         "tagapo": "done", "ulap": "done", "daraitan": "done", "kulis": "done", "talamitam": "done", "osmena-peak": "done",
         "kanlaon": "want"}
GRAB = """() => { const img = document.querySelector('.rp-img');
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return [c.toDataURL('image/png').split(',')[1], img.naturalWidth, img.naturalHeight]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url + ("&" if "?" in url else "?") + "nohero=1", wait_until="domcontentloaded", timeout=90000)
    pg.evaluate(f"() => {{ localStorage.setItem('wg-marks', JSON.stringify({MARKS!r})); localStorage.setItem('wg-lang', '{lang}'); localStorage.removeItem('wg-report'); }}")
    pg.goto(url + ("&" if "?" in url else "?") + "nohero=1", wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_function("() => window.map && map.loaded && map.loaded()", timeout=240000)
    print("badge:", pg.inner_text("#summit-badge").replace("\n", " "))
    pg.click("#summit-badge")
    first = True
    for fmt in ["post", "story"]:
        for theme in ["dawn", "night"]:
            if not first:
                pg.evaluate("() => document.querySelector('.rp-img').removeAttribute('src')")
            pg.click(f'.p3-seg[data-k="format"] button[data-v="{fmt}"]')
            pg.click(f'.p3-seg[data-k="theme"] button[data-v="{theme}"]')
            pg.wait_for_function("() => { const i = document.querySelector('.rp-img'); return i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0 && document.querySelector('.rp-busy').hidden; }", timeout=60000)
            pg.wait_for_timeout(300)
            data, w, h = pg.evaluate(GRAB)
            f = os.path.join(out, f"report-{lang}-{fmt}-{theme}.png")
            open(f, "wb").write(base64.b64decode(data))
            print(f"{fmt}/{theme}: {w}x{h} -> {f}")
            first = False
    pg.fill(".rp-name", "Eddy")
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(out, f"dialog-{lang}.png"))
    with pg.expect_download(timeout=30000) as dl:
        pg.click(".rp-dl")
    print("download:", dl.value.suggested_filename, "| errors:", errs or "none")
    b.close()
