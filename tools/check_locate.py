"""check_locate.py — headless check of the "my location / nearby mountains" feature.

    uv run --no-project --with playwright python tools/check_locate.py [url] [outdir]

Scenarios: located in Santo Tomas, Batangas (nearest list, distances, link to a picked mountain),
permission denied, and located outside the Philippines.
"""
import os, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4321/"
out = sys.argv[2] if len(sys.argv) > 2 else "out/locate"
os.makedirs(out, exist_ok=True)
page_url = url + ("&" if "?" in url else "?") + "nohero=1"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]


def open_page(b, **ctx):
    c = b.new_context(viewport={"width": 1400, "height": 860}, **ctx)
    pg = c.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(page_url, wait_until="load")
    pg.wait_for_function("() => window.map && map.loaded && map.loaded()", timeout=90000)
    return c, pg, errs


def toast(pg):
    pg.wait_for_selector("#toast:not([hidden])", timeout=20000)
    return pg.inner_text("#toast")


with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=ARGS)

    # 1) Santo Tomas, Batangas
    c, pg, errs = open_page(b, permissions=["geolocation"], geolocation={"latitude": 14.1077, "longitude": 121.1411, "accuracy": 30})
    pg.click("#btn-locate")
    print("toast:", toast(pg))
    pg.wait_for_timeout(3500)
    print("sort:", pg.inner_text("#btn-sort span"), "|", pg.inner_text(".list-near"))
    rows = pg.eval_on_selector_all(".m-card", "cs => cs.slice(0, 6).map(c => c.querySelector('.m-card-name').innerText + ' ' + c.querySelector('.m-card-dist').innerText)")
    print("nearest:", " / ".join(rows))
    pg.screenshot(path=os.path.join(out, "1-nearby.png"))
    pg.click('.m-card[data-id="pulag"]')
    pg.wait_for_selector("#detail.open .d-dist", timeout=20000)
    pg.wait_for_timeout(3500)
    print("detail:", pg.inner_text(".d-dist").replace("\n", " "))
    print("map label:", pg.evaluate("() => map.getSource('me-link')._data.features.map(f => f.properties.label).filter(Boolean)"))
    pg.screenshot(path=os.path.join(out, "2-picked.png"))
    pg.click("#btn-detail-close")
    pg.wait_for_timeout(500)
    print("link cleared:", pg.evaluate("() => map.getSource('me-link')._data.features.length === 0"), "| errors:", errs or "none")
    c.close()

    # 2) permission denied
    c, pg, errs = open_page(b, permissions=[])
    pg.click("#btn-locate")
    print("denied toast:", toast(pg))
    c.close()

    # 3) outside the Philippines (Shanghai)
    c, pg, errs = open_page(b, permissions=["geolocation"], geolocation={"latitude": 31.23, "longitude": 121.47})
    pg.click("#btn-locate")
    print("outside toast:", toast(pg), "| errors:", errs or "none")
    c.close()
    b.close()
