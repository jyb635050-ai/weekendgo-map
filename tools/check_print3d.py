"""check_print3d.py — drive the real site in headless Chrome: open a mountain, open the
3D-print dialog, wait for the model, screenshot it and download the 3MF.

    uv run --no-project --with playwright python tools/check_print3d.py [url] [outdir] [mountain ...]
"""
import os, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4321/"
out = sys.argv[2] if len(sys.argv) > 2 else "out/print3d"
ids = sys.argv[3:] or ["pulag"]
os.makedirs(out, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 860}, accept_downloads=True)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(url + ("&" if "?" in url else "?") + "nohero=1", wait_until="load")
    pg.wait_for_function("() => window.map && map.loaded && map.loaded()", timeout=90000)
    for i, mid in enumerate(ids):
        pg.click(f'.m-card[data-id="{mid}"]')
        pg.wait_for_selector("#btn-print3d", timeout=30000)
        pg.wait_for_timeout(2500)
        pg.click("#btn-print3d")
        pg.wait_for_selector(".p3-modal:not([hidden])", timeout=30000)
        pg.wait_for_function("() => { const b = document.querySelector('.p3-dl'); return b && !b.disabled; }", timeout=120000)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(out, f"{mid}-dialog.png"))
        stats = pg.inner_text(".p3-stats")
        with pg.expect_download(timeout=60000) as dl:
            pg.click(".p3-dl")
        f = os.path.join(out, dl.value.suggested_filename)
        dl.value.save_as(f)
        print(f"{mid}: {os.path.getsize(f) / 1e6:.1f} MB -> {f}\n  " + stats.replace("\n", " | "))
        if i == 0 and len(ids) == 1:
            # exercise the options: square, all routes, English UI
            pg.click('.p3-seg[data-k="shape"] button[data-v="square"]')
            pg.click('.p3-seg[data-k="trail"] button[data-v="all"]')
            pg.click('.p3-crow[data-part="terrain"] button[data-c="#3F6B3A"]')
            pg.evaluate("setLang('en')")
            pg.wait_for_timeout(600)
            pg.wait_for_function("() => { const b = document.querySelector('.p3-dl'); return b && !b.disabled; }", timeout=120000)
            pg.wait_for_timeout(1500)
            pg.screenshot(path=os.path.join(out, f"{mid}-square-en.png"))
            with pg.expect_download(timeout=60000) as dl:
                pg.click(".p3-dl")
            f = os.path.join(out, dl.value.suggested_filename)
            dl.value.save_as(f)
            print(f"{mid} square/all/en: {os.path.getsize(f) / 1e6:.1f} MB -> {f}")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
    print("page errors:", errors or "none")
    b.close()
