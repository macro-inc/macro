# Kernel Sans design rules

Kernel Sans is a neo-grotesque close to SF Pro, a shade squarer: large
x-height, flat horizontal terminals, near-monolinear strokes, plus three
details that set it subtly apart. Every glyph follows these rules. When a
rule and a glyph's legibility conflict, legibility wins; note the exception
in a comment.

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
  M with vertical sides, J sitting on the baseline, 1 without a base (the
  tabular `one.tf` alone gets a base, as Inter's does, so its colour matches
  the other tabular figures).
- Widths are written at Regular and widened with weight through
  `p.w(regular_width, k)`: k ≈ 1 for straight two-stem letters, ≈ 0.6 for
  rounds (o e c s, O C G Q D, 0 6 8 9), ≈ 0.5 for one stem. Heavier weights
  should gain colour, not much width (Inter grows about 6% from Light to
  ExtraBold).

## The house details

1. **Squircle curves.** Every round contour is a superellipse (`squircle`,
   `ring`, `parts.bowl`, `parts.open_bowl`, `parts.arch`). Outer contours use
   `p.sq` (2.55), counters the squarer `p.sq_in` (2.85) so the stroke stays
   even at the corners. Capitals and figures use `p.sq * 0.92` and
   `p.sq_in * 0.95`. That is SF Pro's roundness made a shade squarer; never
   use a circle (n = 2), and don't push back toward 3 (it reads as a
   different, boxier face).
2. **Square-cut stroke ends.** No 45° chamfers, bevels or diagonal facets on
   any end.
   - Stem ends are cut flat (horizontal), and corners where a stem turns into
     an arm or bar stay square.
   - Curve terminals are cut horizontally (`parts.open_bowl`; see `c`), or
     vertically when the stroke ends travelling sideways (the hooks of f, g,
     j, r, t). Where a curve would meet a vertical cut at a blade-sharp angle,
     reshape the curve instead of bevelling the corner (see `r`).
   - Free ends of arms and bars (E, F, T, Z, t and f bars) stay square;
     diagonals end in horizontal cuts at the baseline, x-height or cap height.
     Tilted strokes that end in open space are cut vertically (the 1's flag,
     the ð bar); a slanted glyph (ƒ) is cut after slanting, so its ends stand
     upright.
   - Free diagonal strokes that end in open space (× arms, ¤ spokes,
     asterisk arms, arrow barbs, the shafts of ↗ ↘) end square to the
     stroke: a horizontal or vertical cut there would leave a sharp point.
3. **Rounded dots.** Dots of i, j and punctuation are squircles of side
   `p.dot` (0.8 × stem + 44) and exponent `geom.DOT_N` (2.6) (`geom.dot`).
   Accent dots use the same side or very nearly. The i dot's top sits at the
   ascender (760); comma, quote and semicolon tails grow from the same dot.

## Spacing

- Lowercase: straight side `p.sb`, round side `p.sbr`, diagonal side about
  `0.5 * p.sbr`. Capitals: `p.csb`, `p.csbr`, about `0.3 * p.csbr`. The
  sidebearings shrink as weight rises (like Inter); keep using them rather
  than constants so that holds. Dot punctuation (. , : ; !) uses `p.psb`,
  which stops shrinking above Regular. Open sides (E F L T Z, c, r, f) still need a
  real sidebearing: about 0.75 of the straight one.
- Kerning is measured, not typed (`kerning.py`); spacing should look right
  before kerning, with kerning only fixing diagonal, overhanging and
  punctuation pairs.
- Check every glyph between n's and o's (lowercase) or H's and O's (capitals):
  `nnxnnoxoo`, `HHXHHOXOO`. Even colour beats exact numbers.

## Construction

- Joins are clean: no ink traps, notches or steps. Where an arch or bowl
  overshoots a stem that ends flat at x-height or the baseline (n m r u p q b
  d g a @), the stem end runs straight on into the curve (`parts.flush_end`)
  instead of dipping into a V-notch, and a small fillet takes the 12-14°
  corner off where the flat end meets the overshoot. Where two curves meet
  at different slopes (the tilde's S), bridge them along their tangents.
  Proof every join large (`--zoom` at cell 500 or more); a defect a few
  units wide is invisible on a glyph sheet but obvious at display sizes.

- Build with the boolean shape API in `src/kernel_sans/geom.py` and the parts in
  `glyphs/parts.py`. Look at `glyphs/core.py` (n, o, c, H, O, period) first;
  everything else should look like it came from the same hand.
- Use the same construction at every weight (the same shapes meeting in the
  same places), so the variable font can interpolate. Avoid shapes that only
  touch or only overlap at some weights.
- Proof at 300, 400 and 800. A glyph is done when it looks right at all three.
