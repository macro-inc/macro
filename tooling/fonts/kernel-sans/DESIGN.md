# Kernel Sans design rules

Kernel Sans is a neo-grotesque in the Inter / SF Pro mould with a cyber edge:
large x-height, flat horizontal terminals, near-monolinear strokes, plus four
details that make it read as engineered rather than written. Every glyph
follows these rules. When a rule and a glyph's legibility conflict, legibility
wins; note the exception in a comment.

## Skeleton (Inter / SF Pro)

- Cap height 720, x-height 540, ascender 760, descender −200, UPM 1000.
- Round lowercase overshoots `P.OS` (10) at baseline and x-height; round
  capitals and figures overshoot `P.COS` (12). Arch tops overshoot `0.8 * OS`.
- Lining figures at cap height. The default figures are proportional (their
  own sidebearings); `.tf` figures share one tabular advance and come in
  through `tnum`.
- Hyphens, dashes and math operators centre on `P.AXIS` (300); their `.case`
  forms, used with capitals and figures, on `P.CASE_AXIS` (360).
- Marks: lowercase accents sit between about x-height + 70 and 790; `.case`
  accents for capitals between about cap height + 50 and 930.
- A glyph whose visual top centre is not its bounding-box centre (y, a, f, r,
  J, ...) sets `G(anchors={"top": x})` (and `"bottom"` where cedilla or
  ogonek would attach) so accented composites line up.
- Strokes: lowercase verticals `p.stem`, round sides `p.stem * 1.03`,
  horizontals `p.hair`; capitals `p.cstem` / `p.chair`; figures `p.fstem` /
  `p.fhair`. Diagonals are drawn by perpendicular thickness about
  `0.95 * stem`; thinner diagonals of N, M, W, w about `0.9 * stem`.
- Forms: double-storey a, single-storey g, straight-tailed y, k whose arm meets
  the stem, R with a straight leg from the bowl, G with a bar and no spur,
  M with vertical sides, J sitting on the baseline, 1 without a base.
- Widths are written at Regular and widened with weight through
  `p.w(regular_width, k)` (k ≈ 1 for two-stem letters, ≈ 0.5 for one stem).

## The cyber details

1. **Squircle curves.** Every round contour is a superellipse (`squircle`,
   `ring`, `parts.bowl`, `parts.open_bowl`, `parts.arch`). Outer contours use
   `p.sq` (3.0), counters `p.sq_in` (2.7). Capitals and figures use
   `p.sq * 0.92` and `p.sq_in * 0.95`. Never use a circle (n = 2).
2. **45° chamfers at free stroke ends.** Leg `p.cut` (lowercase) or `p.ccut`
   (capitals, figures).
   - A stem's free top gets one chamfer on the glyph's outer side: a left or
     single stem `nw`, a right stem `ne` (see `H`, `n`). Free descender
     bottoms: left stem `sw` (p), right stem `se` (q).
   - Corners where a stem turns into an arm or bar (E, F, L, T joins, the
     baseline of l and i) stay square.
   - Curve terminals are cut horizontally (vertically when the stroke ends
     travelling horizontally, as in the hooks of f, t, j, r) and their outer
     corner is chamfered (`parts.open_bowl` does this; see `c`).
   - Free ends of arms and bars (E, F, T, Z, t and f bars) stay square, and
     so do the ends of diagonals (they are already angled).
3. **Ink traps** at acute crotches where a curve or diagonal joins a stem or
   another stroke: n h m r u (shoulder), b d p q a g (bowl joins), k K (arm
   and leg), and the inner vertices of v w y V W M N A and the figures.
   - Where a curve leaves a stem (shoulders, bowls): `geom.stem_trap`, depth
     `1.3 * p.trap`.
   - At the inner vertex of two straight edges: `geom.crotch_trap`, depth
     `p.trap`, opening at least half its depth wide. Never a long slit or a
     needle cut.
   `p.trap` is about 6 at Light, 12 at Regular and 37 at ExtraBold. Traps
   must open into the white cleanly and never leave slivers.
4. **Square dots.** Dots of i, j, and punctuation are squares of side `p.dot`
   (0.8 × stem + 36) with `nw` + `se` chamfers of 0.22 × side (`geom.dot`).
   Accent dots use the same side or very nearly. The i dot's top sits at the
   ascender (760); comma, quote and semicolon tails grow from the same square.

## Spacing

- Lowercase: straight side `p.sb`, round side `p.sbr`, diagonal side about
  `0.5 * p.sbr`. Capitals: `p.csb`, `p.csbr`, about `0.3 * p.csbr`. The
  sidebearings shrink as weight rises (like Inter); keep using them rather
  than constants so that holds. Open sides (E F L T Z, c, r, f) still need a
  real sidebearing: about 0.75 of the straight one.
- Kerning is measured, not typed (`kerning.py`); spacing should look right
  before kerning, with kerning only fixing diagonal, overhanging and
  punctuation pairs.
- Check every glyph between n's and o's (lowercase) or H's and O's (capitals):
  `nnxnnoxoo`, `HHXHHOXOO`. Even colour beats exact numbers.

## Construction

- Build with the boolean shape API in `src/kernel_sans/geom.py` and the parts in
  `glyphs/parts.py`. Look at `glyphs/core.py` (n, o, c, H, O, period) first;
  everything else should look like it came from the same hand.
- Use the same construction at every weight (the same shapes meeting in the
  same places), so the variable font can interpolate. Avoid shapes that only
  touch or only overlap at some weights.
- Proof at 300, 400 and 800. A glyph is done when it looks right at all three.
