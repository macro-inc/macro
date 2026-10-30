#!/usr/bin/env python3
"""Build Kernel Sans.

    python3 build.py                     # every weight -> fonts/{otf,ttf,woff2,variable}
    python3 build.py --proof --only lower_round [--weights 300,400,800] [--out DIR]
    python3 build.py --zoom a,b,c [--weights 400] [--cell 420] [--out DIR]

`--proof` draws only the named glyph modules (plus `core`), tolerates broken
modules, and writes glyph sheets and text proofs as PNGs to proofs/ (or --out).
"""

import argparse
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from kernel_sans import features, glyphs  # noqa: E402
from kernel_sans import params as P  # noqa: E402
from kernel_sans.fontbuild import build_font, to_woff2  # noqa: E402

DEFAULT_PROOF_TEXT = [
    "Hamburgefonstiv HOHOHO nnonnoo",
    "The quick brown fox jumps over the lazy dog",
]


def draw_weight(wght, strict):
    p = P.params(wght)
    d = glyphs.Drawer(p, strict=strict)
    drawn = d.draw_all()
    return p, drawn, d.errors


def build_static(wght, out_dir, formats, strict=True):
    p, drawn, errors = draw_weight(wght, strict)
    fea = features.feature_code(drawn, p)
    style = P.WEIGHTS[wght] if wght in P.WEIGHTS else str(wght)
    paths = {}
    for fmt in formats:
        kind = "ttf" if fmt in ("ttf", "woff2") else "otf"
        font = build_font(drawn, p, kind, fea)
        os.makedirs(os.path.join(out_dir, fmt), exist_ok=True)
        path = os.path.join(out_dir, fmt, f"{P.PS_FAMILY}-{style}.{fmt}")
        if fmt == "woff2":
            to_woff2(font, path)
        else:
            font.save(path)
        paths[fmt] = path
    return paths, drawn, errors


def zoom(names, weights, out_dir, cell):
    """Large glyph sheets of just the named glyphs, one per weight."""
    from kernel_sans.proof import glyph_sheet

    load_errors = glyphs.load_modules(strict=False)
    for mod, err in load_errors.items():
        print(f"!! module {mod} failed to import:\n{err}", file=sys.stderr)
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="ks-zoom-")
    for wght in weights:
        paths, drawn, errors = build_static(wght, tmp, ["ttf"], strict=False)
        for name, err in errors.items():
            if name in names:
                print(f"!! {name} @ {wght} failed:\n{err}", file=sys.stderr)
        out = os.path.join(out_dir, f"zoom-{wght}.png")
        glyph_sheet(paths["ttf"], names, out, title=f"{wght} {P.WEIGHTS.get(wght, '')}", cell_h=cell, cols=max(1, 1800 // int(cell * 0.75)))
        print("wrote", out)


def proof(only, weights, out_dir):
    from kernel_sans.proof import glyph_sheet, text_proof

    load_errors = glyphs.load_modules(only=only, strict=False)
    for mod, err in load_errors.items():
        print(f"!! module {mod} failed to import:\n{err}", file=sys.stderr)
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="ks-proof-")
    fonts = []
    mods = only or glyphs.MODULES
    names_by_mod = {}
    for wght in weights:
        paths, drawn, errors = build_static(wght, tmp, ["ttf"], strict=False)
        for name, err in errors.items():
            print(f"!! {name} @ {wght} failed:\n{err}", file=sys.stderr)
        fonts.append((f"{wght} {P.WEIGHTS.get(wght, '')}", paths["ttf"]))
        for mod in mods:
            names = [n for n in drawn if glyphs.REGISTRY[n].module == mod]
            names_by_mod[mod] = names
            if names:
                out = os.path.join(out_dir, f"{mod}-glyphs-{wght}.png")
                glyph_sheet(paths["ttf"], names, out, title=f"{mod} · {wght} {P.WEIGHTS.get(wght, '')}")
                print("wrote", out)
    for mod in mods:
        m = sys.modules.get(f"kernel_sans.glyphs.{mod}")
        lines = getattr(m, "PROOF_TEXT", None) or DEFAULT_PROOF_TEXT
        out = os.path.join(out_dir, f"{mod}-text.png")
        text_proof(fonts, lines, out, size=52)
        print("wrote", out)
        big = os.path.join(out_dir, f"{mod}-text-small.png")
        text_proof(fonts, lines, big, size=18, width=1200)
        print("wrote", big)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proof", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated glyph modules")
    ap.add_argument("--weights", default="", help="comma-separated weight classes")
    ap.add_argument("--out", default="")
    ap.add_argument("--formats", default="otf,ttf,woff2")
    ap.add_argument("--no-variable", action="store_true")
    ap.add_argument("--zoom", default="", help="comma-separated glyph names to render large")
    ap.add_argument("--cell", type=int, default=420, help="cell height in px for --zoom")
    ap.add_argument("--specimen-embed", default="", help="also write a self-contained specimen to this path")
    args = ap.parse_args()
    only = [m for m in args.only.split(",") if m]
    if args.zoom:
        weights = [int(w) for w in args.weights.split(",") if w] or [300, 400, 800]
        zoom(args.zoom.split(","), weights, args.out or os.path.join(HERE, "proofs"), args.cell)
        return
    if args.proof:
        weights = [int(w) for w in args.weights.split(",") if w] or [300, 400, 800]
        proof(only, weights, args.out or os.path.join(HERE, "proofs"))
        return
    glyphs.load_modules(strict=True)
    weights = [int(w) for w in args.weights.split(",") if w] or sorted(P.WEIGHTS)
    out_dir = args.out or os.path.join(HERE, "fonts")
    formats = [f for f in args.formats.split(",") if f]
    for wght in weights:
        paths, drawn, _ = build_static(wght, out_dir, formats, strict=True)
        print(f"{wght}: {len(drawn)} glyphs ->", ", ".join(os.path.relpath(v, HERE) for v in paths.values()))
    if not args.no_variable:
        from kernel_sans.variable import build_variable

        for path in build_variable(out_dir):
            print("variable ->", os.path.relpath(path, HERE))
        if set(weights) == set(P.WEIGHTS):
            from kernel_sans.specimen import build_specimen

            page = build_specimen(out_dir, os.path.join(HERE, "specimen", "index.html"))
            print("specimen ->", os.path.relpath(page, HERE))
            if args.specimen_embed:
                print("specimen (embedded font) ->", build_specimen(out_dir, args.specimen_embed, embed=True))


if __name__ == "__main__":
    main()
