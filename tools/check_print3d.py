"""check_print3d.py — drive the real site in headless Chrome: open a mountain, open the
3D-print dialog, wait for the model, screenshot front + back, download 3MFs with different options.

    uv run --no-project --with playwright python tools/check_print3d.py [url] [outdir] [mountain]

Then slice what it saved:  python tools/slice_check.py <file> --colors N
  <id>_full.3mf    name + elevation + trail, 4 colours  -> --colors 4
  <id>_plain.3mf   no name, no trail, custom body colour -> --colors 3
"""
import os, sys
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4321/"
out = sys.argv[2] if len(sys.argv) > 2 else "out/print3d"
mid = sys.argv[3] if len(sys.argv) > 3 else "pulag"
os.makedirs(out, exist_ok=True)
READY = "() => { const b = document.querySelector('.p3-dl'); return b && !b.disabled; }"

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 860}, accept_downloads=True)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(url + ("&" if "?" in url else "?") + "nohero=1", wait_until="load")
    pg.wait_for_function("() => window.map && map.loaded && map.loaded()", timeout=90000)
    pg.click(f'.m-card[data-id="{mid}"]')
    try:
        pg.wait_for_selector("#btn-print3d", state="attached", timeout=45000)
    except Exception:
        pg.screenshot(path=os.path.join(out, f"{mid}-nodetail.png"))
        print("detail did not open:", pg.get_attribute("#detail", "class"), "| errors:", errors[:5])
        raise
    pg.wait_for_timeout(2500)
    pg.click("#btn-print3d")
    pg.wait_for_selector(".p3-modal:not([hidden])", timeout=30000)
    pg.wait_for_function(READY, timeout=120000)
    pg.wait_for_timeout(1200)

    def save(tag):
        with pg.expect_download(timeout=60000) as dl:
            pg.click(".p3-dl")
        f = os.path.join(out, f"{mid}_{tag}.3mf")
        dl.value.save_as(f)
        print(f"{tag}: {os.path.getsize(f) / 1e6:.1f} MB -> {f}")

    # stop the auto-spin and look at the front, then drag half a turn to see the back
    box = pg.locator(".p3-canvas").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.up()
    pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(out, f"{mid}-front.png"))
    pg.mouse.move(cx - 200, cy); pg.mouse.down(); pg.mouse.move(cx + 193, cy, steps=12); pg.mouse.up()
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(out, f"{mid}-back.png"))
    print("stats:", pg.inner_text(".p3-stats").replace("\n", " | "))
    save("full")

    # name off, trail off, custom body colour
    pg.uncheck('.p3-tog input[data-k="showName"]')
    pg.click('.p3-seg[data-k="trail"] button[data-v="none"]')
    pg.evaluate("""() => { const i = document.querySelector('.p3-crow[data-part="terrain"] .p3-custom input');
                           i.value = '#5a8f7b'; i.dispatchEvent(new Event('input', { bubbles: true })); }""")
    pg.wait_for_timeout(500)
    pg.wait_for_function(READY, timeout=120000)
    pg.wait_for_timeout(1000)
    pg.screenshot(path=os.path.join(out, f"{mid}-plain.png"))
    save("plain")
    print("page errors:", errors or "none")
    b.close()
