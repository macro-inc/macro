# Kernel Sans

## What it is

A font family generated from Python: a neo-grotesque close to Inter and SF Pro
with squircle curves, chamfered stroke ends, ink traps and square dots. Six
static weights (300–800) and a variable font are built into `fonts/`.

## How it works

Each glyph is a function of per-weight `Params` that combines simple shapes
with boolean operations (skia-pathops). `build.py` draws every glyph for each
weight, compiles CFF `.otf`, TrueType `.ttf` and `.woff2`, then matches the
300/400/800 outlines point for point to build the variable font.

## Start here

- `DESIGN.md`: the house rules every glyph follows.
- `src/kernel_sans/glyphs/core.py`: reference glyphs (n o c H O period).
- `src/kernel_sans/geom.py`, `glyphs/parts.py`: the shape API and shared parts.
- `src/kernel_sans/params.py`: metrics and how weights derive from the stem.

## Recipes

- Add a glyph: draw it in the module for its group (`glyphs/<module>.py`) with
  `@glyph(name, codepoint)`, proof it, rebuild.
- Add an alternate: register `name.ss0N`, `name.zero` or `name.case`;
  `features.py` writes the substitution. Name new stylistic sets in
  `STYLISTIC_SET_NAMES`.
- Kerning: classes in `kerning.py`; values are measured from the outlines at
  each weight. Tune with `FACTOR`, or `TWEAKS` for one pair of classes.
- Proof: `python3 build.py --proof --only <module> --out /tmp/proofs` or
  `python3 build.py --zoom a,b --weights 400,800`.
- Check variable compatibility: `python3 build.py --compat --only <module>`.

## Checks

- `python3 -m unittest discover tests` (from this directory; about a minute).
- `python3 build.py`, then commit the regenerated `fonts/` and `specimen/`
  with the source change.
- Requires `pip install fonttools skia-pathops brotli`; proofs also need
  `freetype-py` and Pillow with raqm.

## Gotchas

- Keep a glyph's topology identical across weights. `compat.py` absorbs
  contour order, start points and extra smooth nodes, but not a different
  number of contours or corners. Shapes that touch, or meet exactly on a
  centre line, at some weights only cause that; `--compat` names the glyph.
- Join a stem to a curve edge to edge at the curve's vertical extreme
  (`rect(..., yc)`), never with a small overlap: pathops can drop or split the
  curve differently per weight.
- `geom.chamfer`, `trap` and `notch` return regions to subtract, not shapes
  to add.
- pathops outlines are counter-clockwise (PostScript order); `fontbuild.py`
  reverses them for TrueType.
- `fonts/` is generated; never edit those files by hand.
