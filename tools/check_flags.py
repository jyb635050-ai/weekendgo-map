"""check_flags.py — headless check of summit flags + the climbed-count badge.

    uv run --no-project --with playwright python tools/check_flags.py [url] [outdir]
"""
import os, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4321/"
out = sys.argv[2] if len(sys.argv) > 2 else "out/flags"
os.makedirs(out, exist_ok=True)
page_url = url + ("&" if "?" in url else "?") + "nohero=1"
FLAGS = "() => JSON.stringify(map.getFilter('peaks-flag'))"


def ready(pg):
    pg.goto(page_url, wait_until="domcontentloaded", timeout=90000)
    pg.wait_for_function("() => window.map && map.loaded && map.loaded() && map.getLayer('peaks-flag')", timeout=90000)


def climb(pg, mid):
    pg.click(f'.m-card[data-id="{mid}"]')
    pg.wait_for_selector("#detail.open .d-mark.done", timeout=30000)
    pg.wait_for_timeout(2500)
    pg.click("#detail-body .d-mark.done")
    pg.wait_for_function("() => !document.querySelector('#toast').hidden", polling=200, timeout=15000)
    t = pg.evaluate("() => document.querySelector('#toast').textContent")
    pg.wait_for_timeout(1800)
    return t


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    c = b.new_context(viewport={"width": 1400, "height": 860})
    pg = c.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    ready(pg)
    print("badge at start:", pg.inner_text("#summit-badge").replace("\n", " "))
    print("toast 1:", climb(pg, "batulao"))
    pg.screenshot(path=os.path.join(out, "1-planted.png"))
    print("toast 2:", climb(pg, "pulag"))
    print("flags:", pg.evaluate(FLAGS), "| badge:", pg.inner_text("#summit-badge").replace("\n", " "))
    pg.click("#btn-detail-close")
    pg.click("#btn-home-view")
    pg.wait_for_timeout(3500)
    pg.screenshot(path=os.path.join(out, "2-overview.png"))
    ready(pg)                                    # reload: flags + count come back from localStorage
    print("after reload:", pg.evaluate(FLAGS), "| badge:", pg.inner_text("#summit-badge").replace("\n", " "))
    pg.click('.m-card[data-id="batulao"]')
    pg.wait_for_selector("#detail.open .d-mark.done.on", timeout=30000)
    pg.click("#detail-body .d-mark.done")       # un-climb
    pg.wait_for_timeout(800)
    print("after unmark:", pg.evaluate(FLAGS), "| badge:", pg.inner_text("#summit-badge").replace("\n", " "))
    pg.click("#btn-detail-close")
    pg.click("#summit-badge")
    pg.wait_for_timeout(800)
    print("badge click -> tab:", pg.inner_text("#mark-tabs .mtab.on"), "| cards:", pg.locator(".m-card").count(), "| errors:", errs or "none")
    c.close()

    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = m.new_page()
    ready(pg)
    pg.evaluate("() => { localStorage.setItem('wg-marks', JSON.stringify({pulag:'done', apo:'done', batulao:'done', maculot:'want'})); }")
    ready(pg)
    pg.wait_for_timeout(2000)
    pg.screenshot(path=os.path.join(out, "3-mobile.png"))
    print("mobile badge:", pg.inner_text("#summit-badge").replace("\n", " "))
    b.close()
