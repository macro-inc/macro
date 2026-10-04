# pptx_engine

A from-scratch PowerPoint (`.pptx`) engine: it parses, renders, edits, and
saves presentations. The same Rust code runs natively (AI tools in the
documents crate, tests, the corpus CLI) and as WebAssembly in the web app's
presentation editor worker (`apps/web/src/lib/core/pptx-engine`).

Third-party code is limited to small libraries: `tiny-skia` (rasterizing),
`skrifa` (font tables and glyph outlines), `png`, `zune-jpeg`, `gif`, `miniz_oxide`
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
text (set, insert, delete, run and paragraph formatting, body properties
including every vertical text direction, text shadow and glow), shapes (transform, fill, outline, geometry, add,
delete, duplicate, z-order, picture replacement, and the shadow, glow, soft
edge, and reflection galleries of Shape Effects), pictures (crop keeping the
image in place, crop to fill or fit the frame, brightness, contrast,
recolor, transparency), tables (cell text, rows, columns), slides (add from a
layout, duplicate, delete, move, hide, notes, background), charts (data,
type, title, legend, data labels, series colors, new charts), animations,
and the deck's drawing guides (`p15:sldGuideLst`).
The same JSON
vocabulary is used by the browser editor and by the `EditPresentation` AI
tool; with the `schema` feature the operations derive JSON Schemas.

Chart edits rewrite the chart part's data caches and the embedded workbook
PowerPoint's "Edit Data" opens (its data sheet and any table over it; other
workbook parts keep their bytes). Data and type edits apply to single-plot
bar, column, line, pie, doughnut, and area charts with cached data (the
outline's `chart.editable`); new charts are built through the same code and
come with a generated workbook.

After text edits, shapes with `normAutofit` are re-fitted (PowerPoint's font
scale ladder) and `spAutoFit` shapes grow to their text, so saved files open
in PowerPoint without a reflow. Relationships no longer referenced are pruned
and orphaned parts are removed.

Shapes can be grouped and ungrouped; group members are addressed and edited in
slide space (their outline frames are where they would sit on the slide, and
ungrouping bakes the group's offset, scale, rotation, and flips into them).
`copy_shapes` and `copy_slides` produce self-contained clipboard payloads
(JSON with every referenced part: pictures, media, charts and their
workbooks) that `PasteShapes` and `PasteSlides` insert into this or another
presentation; copied placeholders become ordinary shapes carrying their
inherited position and text formatting, and theme references follow the
destination theme. Slides can change layout (placeholders rebind by type and
index), carry transitions (including the `p14` and `p159` morph forms), and
`find_text` / `ReplaceText` search and replace across shapes, groups, and
table cells.

### Animations

A slide's main animation sequence (`p:timing`) reads as a flat list in
playback order (`SlideOutline.animations`): shape, class, effect name,
PowerPoint preset id and subtype, start (`onClick`, `withPrevious`,
`afterPrevious`), duration, delay, option (`direction`), paragraph, repeat,
and the path of motion paths. `SetAnimations` replaces the list,
`AddAnimation` inserts one, `RemoveAnimations` drops some; the sequence's
click and time groups are laid out again as PowerPoint lays them out.
Entries that match an existing animation keep its markup (sounds,
smoothing, presets the engine does not write) and only change its timing;
new ones get the behaviors PowerPoint writes for their preset and a build
entry for text shapes. Trigger sequences and media nodes are kept. After
every batch, animations of shapes or paragraphs the batch removed are
dropped, so a saved file never names a missing shape.

| Class | Effects (default duration in ms) | Options (`direction`, default first) |
| --- | --- | --- |
| entrance | `appear` (0), `fade`, `split`, `wipe`, `randomBars`, `growTurn`, `zoom`, `flyIn` (500), `floatIn` (1000), `shape`, `wheel`, `swivel`, `bounce` (2000) | `flyIn`: `bottom`, `left`, `right`, `top`, `bottomLeft`, `bottomRight`, `topLeft`, `topRight`; `floatIn`: `up`, `down`; `split`: `verticalOut`, `horizontalOut`, `verticalIn`, `horizontalIn`; `wipe`: `bottom`, `left`, `right`, `top`; `shape`: `circleOut`, `circleIn`, `boxOut`, `boxIn`, `diamondOut`, `diamondIn`, `plusOut`, `plusIn`; `wheel`: `spokes1`, `spokes2`, `spokes3`, `spokes4`, `spokes8`; `randomBars`: `horizontal`, `vertical`; `zoom`: `objectCenter`, `slideCenter` |
| emphasis | `pulse`, `colorPulse` (500), `teeter`, `boldFlash`, `wave` (1000), `spin`, `growShrink`, `desaturate`, `darken`, `lighten`, `transparency` (2000) | `spin`: `clockwise`, `counterclockwise` |
| exit | `disappear` (0), `fadeOut`, `flyOut`, `split`, `wipe`, `randomBars`, `shrinkTurn`, `zoom` (500), `floatOut` (1000), `shape`, `wheel`, `swivel`, `bounce` (2000) | as entrance; `floatOut`: `down`, `up`; `split` and `shape` default to `verticalIn` and `circleIn` |
| path | `path` (2000) | `down`, `left`, `right`, `up` (a line a quarter of the slide long), or a `path` of its own |

Other PowerPoint presets read under their names (`blinds`, `basicZoom`,
`boomerang`, `fontColor`, media `play`...) or as `custom`; those, and media
and OLE-verb actions, can be kept but not created.

Slide masters and layouts are edited as Slide Master view edits them. Their
ids (`p:sldMasterId/@id`, `p:sldLayoutId/@id`, at least 2147483648, so
never a slide's) address them wherever a slide id or index is taken: shape,
text, table, chart, picture, and background operations, outlines, rendering,
text layout, and copying shapes. Formatting whole paragraphs of a master or
layout placeholder also writes the list style (or the master's title and body
text styles) slides inherit. `AddLayout` (PowerPoint's Insert Layout, or a
copy), `RenameLayout`, `DeleteLayout` (refused while slides use it),
`InsertPlaceholder`, and `SetLayoutOptions` (Title, Footers, Hide Background
Graphics) change the layouts, and `SetBackgroundStyle` gives a slide, master,
or layout one of the theme's twelve background styles; the outline's `masters` lists them with the
slides using each, and edit results report changed masters and layouts in
`changed_layouts`. Masters and layouts a file lists without ids (PowerPoint
2008 for Mac) get stable ones, stored when the lists change.

Deck-level edits follow PowerPoint's dialogs. Header & Footer adds or removes
the slide number, date, and footer placeholders (copied from each slide's
layout) and, applied to all slides, records the choice in the masters' `p:hf`,
which slides added later follow. Slide numbers count from the deck's
`firstSlideNum`; automatic dates render from the clock the host sets
(`Presentation::set_clock`; the browser worker passes its local time) and from
the text cached in the file without one, so tests and the corpus stay
deterministic. Slide Size rewrites `p:sldSz` and can scale every slide,
layout, master, chart, and SmartArt drawing as "Ensure Fit" or "Maximize" do.
Sections (`p14:sectionLst`) can be added, renamed, removed, and moved, and stay
consistent when slides are added, duplicated, pasted, moved, or deleted.

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
- Editing does not create SmartArt; it keeps the diagrams a deck has.
  Combination, scatter, bubble, stock, surface, and radar charts take
  formatting edits but not data or type edits.
- Animations: rendering shows every shape, as PowerPoint's editing view
  does (the web slide show plays the builds); new effects take PowerPoint's gallery
  options only (no sounds, smoothing, or text-by-letter settings), and
  paragraph animations keep their indexes when paragraphs are inserted
  above them. Effects without a shape target (sounds alone) are dropped
  when a slide's sequence is rewritten.
