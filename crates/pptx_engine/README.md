# pptx_engine

A from-scratch PowerPoint (`.pptx`) engine: it parses, renders, edits, and
saves presentations. The same Rust code runs natively (AI tools in the
documents crate, tests, the corpus CLI) and as WebAssembly in the web app's
presentation editor worker (`apps/web/src/lib/core/pptx-engine`).

Third-party code is limited to small libraries: `tiny-skia` (rasterizing),
`ttf-parser` (font tables), `png`, `zune-jpeg`, `gif`, `miniz_oxide`
(deflate), and `serde`. The ZIP container, XML DOM, OPC packaging,
DrawingML model, geometry presets, text layout, EMF/WMF interpreter, charts,
and the editing engine are implemented here.

## Design

The XML of every part stays the source of truth. Rendering derives a model
from it; edits mutate the XML in place and write only the parts they touched.
Content the engine does not understand (animations, macros, custom XML,
unknown extensions) therefore survives a save untouched, and saving an
unedited deck reproduces every part byte for byte.

```
zip, xml, opc       container, mutable namespace-aware DOM, parts/rels/content types
model               presentation, slides, inheritance (slide → layout → master → theme),
                    colors, fills, text, tables, shapes
geometry            the 187 preset shapes and custom geometry (DrawingML formulas)
render              display lists (scene), text layout, pictures, tables, charts,
                    EMF/WMF, effects; rasterized with tiny-skia
font                font database, family substitution, metrics, kerning, outlines
inspect             outlines and caret layouts for editors and AI tools
edit                EditOp batches, undo/redo, autofit, slide/notes/table structure
collab              the presentation as CRDT maps for live collaboration
fidelity            image comparison, fingerprints, the corpus baseline format
wasm                the wasm-bindgen API used by the browser worker
```

### Editing

`Presentation::apply(&[EditOp], &FontDb)` applies a batch atomically: if any
operation fails, the presentation is left exactly as it was. `Editor` adds
undo/redo (snapshots of the immutable part maps are cheap) and merges typing
into one undo step per group. Slides are addressed by their stable
`p:sldId/@id`, shapes by `p:cNvPr/@id`, positions in points. Operations cover
text (set, insert, delete, run and paragraph formatting, body properties),
shapes (transform, fill, outline, geometry, add, delete, duplicate, z-order,
picture replacement), tables (cell text, rows, columns), slides (add from a
layout, duplicate, delete, move, hide, notes, background). The same JSON
vocabulary is used by the browser editor and by the `EditPresentation` AI
tool; with the `schema` feature the operations derive JSON Schemas.

After text edits, shapes with `normAutofit` are re-fitted (PowerPoint's font
scale ladder) and `spAutoFit` shapes grow to their text, so saved files open
in PowerPoint without a reflow. Relationships no longer referenced are pruned
and orphaned parts are removed.

### Collaboration

`collab` describes a presentation as flat string maps (Loro containers in the
web app and on the sync service): every part, with slides split into a frame
plus one entry per top-level shape, relationships one per entry, content
types, and slide and shape positions as fractional keys. Peers editing
different shapes, slides, or relationships merge without conflict.
`Presentation::enable_collab` seeds the maps from a file,
`Presentation::from_entries` opens them, `collab_changes` reports the entries
local edits changed, and `apply_collab_changes` applies other peers' changes.
In collaborative mode new part names and slide, shape, and relationship ids are
random (`opc::IdSource`), so concurrent additions never collide. The corpus
test checks that every deck renders identically after a round trip through
the maps.

### Fonts

The engine bundles metric-compatible fonts (Liberation Sans/Serif/Mono for
Arial/Times New Roman/Courier New, Carlito for Calibri, Caladea for Cambria,
DejaVu Sans), which are what layout is calibrated against. Native builds
compile them in with the `embedded-fonts` feature; the wasm build always does,
since the worker has no font directory. Other families map to the closest of
those (`font::SUBSTITUTES`), and hosts can register more font files.
`FontDb::missing_families` reports what a deck asked for but did not get.

## Using it

```rust
use pptx_engine::{EditOp, Presentation, font::FontDb};

let mut deck = Presentation::open(std::fs::read("deck.pptx")?)?;
let fonts = FontDb::global(); // needs the `embedded-fonts` feature
let png = deck.render_slide(0, 1280, fonts)?.to_png();
let outline = deck.outline()?; // slides, shapes, text, tables, layouts
deck.apply(
    &[EditOp::SetText { slide: outline.slides[0].id, shape: 2, cell: None, text: "Q3 review".into() }],
    fonts,
)?;
std::fs::write("edited.pptx", deck.save()?)?;
```

The browser build: `just build-pptx-engine-wasm` from `apps/web` (wasm-pack,
`--target web`, SIMD enabled; `ensure-pptx-engine-wasm` rebuilds only when
sources changed).

## Testing

- `cargo test -p pptx_engine` runs the unit tests and the corpus regression
  test (`tests/corpus.rs`), which renders every deck in `tests/corpus` and
  compares fingerprints with `tests/corpus/baseline.json`.
- The `pptx_corpus` CLI (`--features cli`) renders decks, scores them against
  LibreOffice reference renders (SSIM, mismatch, HTML report), maintains the
  baseline ratchet, and runs edit round-trip checks over the whole corpus.
  See [tests/corpus/README.md](tests/corpus/README.md).
- The web editor has Playwright tests against a fixture page:
  `apps/web/src/features/block-pptx/browser-test`.

Current state (53 decks, 511 slides; LibreOffice 24.2 references with the
engine's fonts): mean SSIM 0.89, median 0.93. LibreOffice is a reference, not
ground truth; slide `note`s in the baseline record known cases where it is the
one that differs from PowerPoint (pattern fills, for example).

## Known gaps

- Text: no complex-script shaping (Arabic joining, Indic reordering), no
  hyphenation, no font-based fallback for CJK beyond the bundled faces.
  Fonts without a metric-compatible substitute change line breaks.
- Charts: surface charts, error bars, and pie-of-pie are approximated or
  skipped; 3-D line and area charts are drawn flat.
- Pictures: TIFF and WDP (JPEG XR) are not decoded (a placeholder is drawn);
  SVG pictures are drawn from their PNG fallback; video and audio show their
  poster frames.
- Effects: 3-D bevels and extrusion are not drawn; soft edges and reflections
  are approximations.
- SmartArt is drawn from the drawing PowerPoint caches with it; the rare
  diagram saved without one (1 of 16 in the corpus) is left empty, since the
  SmartArt layout algorithms are not implemented.
- Editing does not create charts, SmartArt, or animations; it keeps the ones
  a deck has.
