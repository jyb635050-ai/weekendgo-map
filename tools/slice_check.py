#!/usr/bin/env python
"""slice_check.py -- slice a 3MF with the local Bambu Studio CLI and check it prints in N colours.

    python tools/slice_check.py relief.3mf --colors 3 [--keep]

Exit: 0 pass, 1 fail, 2 script/environment error (not a verdict).
Pass = slicer return_code 0 and the G-code's "total filament length" line uses exactly --colors filaments.
Slicing recipe (Bambu Studio 2.7 CLI + flattened A1 profiles) comes from D:\\blender\\PrintLapse\\tools\\make_fixtures.py.
"""
import argparse, os, re, shutil, subprocess, sys, tempfile, zipfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

MF_DIR = r"D:\blender\PrintLapse\tools"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--colors", type=int, required=True)
    ap.add_argument("--keep", action="store_true")
    for a in sys.argv[1:]:
        if a.startswith("-") and a.split("=")[0] not in ("--colors", "--keep", "-h", "--help"):
            print("UNKNOWN ARG %s" % a); return 2
    args = ap.parse_args()
    if not os.path.isfile(args.model):
        print("ERR no such file: %s" % args.model); return 2
    sys.path.insert(0, MF_DIR)
    try:
        import make_fixtures as MF
    except Exception as e:
        print("ERR cannot import slicing recipe from %s: %s" % (MF_DIR, e)); return 2
    if not os.path.isfile(MF.EXE):
        print("ERR Bambu Studio not found: %s" % MF.EXE); return 2

    palette = ["#FF0000", "#0000FF", "#FFFFFF", "#111111", "#00C000", "#FFD400"]
    work = tempfile.mkdtemp(prefix="slicechk_")
    out = os.path.join(work, "sliced.gcode.3mf")
    try:
        try:
            MF.slice_model(os.path.abspath(args.model), out, work, palette[:args.colors])
        except SystemExit as e:
            print("FAIL slicing failed: %s" % e); return 1
        except subprocess.TimeoutExpired:
            print("FAIL slicing timed out"); return 1
        if not os.path.isfile(out):
            print("FAIL slicer produced no file"); return 1
        with zipfile.ZipFile(out) as z:
            gs = [n for n in z.namelist() if n.endswith(".gcode")]
            if not gs:
                print("FAIL no G-code in output"); return 1
            g = z.read(gs[0]).decode("utf-8", "ignore")
        m = re.search(r"^; total filament length \[mm\] : (.+)$", g, re.M)
        if not m:
            print("FAIL no filament usage line"); return 1
        used = [x for x in m.group(1).split(",") if float(x) > 0]
        if len(used) != args.colors:
            print("FAIL expected %d filaments, used %d (%s)" % (args.colors, len(used), m.group(1))); return 1
        lm = re.search(r"^; total layer number: (\d+)$", g, re.M)
        layers = int(lm.group(1)) if lm else len(re.findall(r"^; CHANGE_LAYER", g, re.M))
        if layers < 5:
            print("FAIL only %d layers" % layers); return 1
        print("PASS %s: sliced, %d filaments, %d layers" % (os.path.basename(args.model), len(used), layers))
        return 0
    finally:
        if args.keep:
            print("kept in %s" % work)
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print("ERR script error: %r" % e)
        sys.exit(2)
