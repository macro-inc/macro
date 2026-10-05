# fig_engine

A from-scratch Figma (`.fig`) engine: it decodes design files, expands
component instances, rasterizes any region at any scale, answers the
editor's questions (layers, hit tests, node properties, search), applies
edits with undo, and saves `.fig` files. The same Rust
code runs natively (tests, the `fig_render` CLI) and as WebAssembly in the web
app's `.fig` viewer workers (`apps/web/src/lib/core/fig-engine`).

Third-party code is limited to small libraries: `tiny-skia` (rasterizing),
`miniz_oxide` and `ruzstd` (deflate and zstd), `png`, `zune-jpeg`, `gif`, and
`image-webp` (image fills), `skrifa` (reading fonts) and
`brotli-decompressor` (WOFF2), and `serde`. The ZIP reader, kiwi decoder, scene
model, instance expansion, effects, and text drawing are implemented here.

## The format

A `.fig` file is either a ZIP (`canvas.fig`, `meta.json`, `thumbnail.png`,
and image fills under `images/<sha1>`) or, in older files, the bare document.
The document is an 8-byte magic (`fig-kiwi`), a format version, and
length-prefixed chunks: a compressed [kiwi](https://github.com/evanw/kiwi)
schema, the compressed message, and sometimes a PNG thumbnail. Every file
carries its own schema, so the engine looks fields up by name and works across
Figma versions; fields it does not use are skipped without being
materialized.

The message is a flat list of node changes (each with a GUID, a parent GUID,
and a fractional-index position string) plus blobs. Figma stores what it
already computed: vector and stroke outlines as command blobs, glyph outlines
and positions for text, and the resolved layout of every instance sublayer
(`derivedSymbolData`). The engine draws from that derived data rather than
re-running Figma's layout, which is what makes renders match Figma without
fonts or an auto-layout engine. FigJam objects (stickies, shapes with text,
connectors) store their visible layers the same way: paints and text in
`nodeGenerationData`, geometry and glyphs in `derivedImmutableFrameData`,
which the scene builds as generated layers. Older files keep image fills in
the message's blobs (`Image.dataBlob`). Nodes using shared styles draw the
style's paints, and image paints apply their adjustments (exposure,
contrast, and the rest) with curves calibrated against Figma's renders.

## Design

```
container, zip   the two file layouts, decompression
kiwi             schema and message decoding (allowlisted fields, by-name access)
decode           kiwi messages → `model::Props` (paints, effects, text, symbols)
document         nodes, the tree, pages, blobs (geometry parsed lazily, once)
scene            one page with instances expanded: overrides, component
                 properties, swaps, shared styles, world transforms, bounds
render           tiles: fills, strokes (inside/outside via clipping), masks,
                 blend modes, isolation, effects (shadows, blurs), images, text
inspect          layer rows, frames, hit tests, marquee, node info, search, SVG outlines
edit             edit operations, undo/redo, fractional-index positions;
                 auto layout (stacks re-laid out after edits); booleans,
                 flatten, and vectors (edit/shapes); pasting (edit/paste)
collab           editing together: node states as CRDT map entries
boolean          path union, subtract, intersect, and exclude
vector           vector networks: the `vectorNetworkBlob` format, fill
                 regions and stroke paths, conversion from outlines
svg              SVG export of a layer, as Figma writes it
text             text layout for edited text: fonts (bundled Inter, registered
                 TTF/OTF/WOFF/WOFF2, variable axes), kerning, wrapping,
                 per-character styles, caret geometry for the editor
save             writing `.fig`: patch edited records, splice the rest; blank
                 files; the clipboard document (save/clipboard)
wasm             the worker API (`FigFile`)
```

## Editing and saving

Edits are operations on the document (`edit::Op`, sent as JSON by the web
editor): set properties, move, create, delete, duplicate, reorder, group.
Each step snapshots the nodes it touches, so undo restores them; nodes
record which properties were edited. Saving decodes the original file again
with its full schema, copies every unedited node record byte for byte,
re-encodes edited ones with only the edited fields replaced, and appends new
nodes (copies start from their source's record) and blobs. Fields the engine
does not model therefore survive, and saving a large file takes about as
long as compressing it. `fig_render roundtrip` checks that edited, saved,
and reopened files render identically.

Auto layout frames are laid out again when an edit changes them or their
children: fill and stretch sizing, gaps (fixed or automatic), padding,
alignment (including text baselines), min and max sizes, strokes included
in layout, and hugging, which carries the change up through hugging
parents. Hidden frames keep their layout until shown, as in Figma.
`fig_render relayout` re-lays out every stack in a file and reports the
frames placed differently from Figma's own layout.

Boolean layers (`BOOLEAN_OPERATION`) keep their children; the engine
combines the children's fill outlines (and, for layers with only strokes,
their stroke outlines) and stores the result as the boolean's fill
geometry, as Figma does, recomputing it when a child changes. The
combination flattens curves to an integer grid, splits them where they
cross, keeps the pieces the operation's winding test selects, and fits
cubic runs back onto the pieces that came from curves. Flatten (and the pen,
and editing a shape's points) produces `VECTOR` layers whose
`vectorData.vectorNetworkBlob` holds the points, segments, and fill
regions; their geometry is regenerated from the network after each edit.
Files whose schema predates these fields get them added on save.
`fig_render booleans` recomputes every boolean in a file and reports how
much the result overlaps Figma's stored geometry.

Copying writes the selection as a bare `fig-kiwi` document like Figma's
clipboard (the layers on a page at their page positions, with the
components and shared styles they show on an internal page) and the images
it uses as a ZIP. Pasting decodes such a document from any file, translates
its records into the target file's schema, gives every node a new GUID,
detaches instances whose components are not in the target, and saves the
pasted records over their original bytes so unmodeled fields survive
(peers in a live session receive the pasted nodes and images as ordinary
entries, so a save from another peer writes their modeled fields). A main
component pasted into the file that has it becomes an instance, as in
Figma. `PasteSpec` places the layers by Figma's rules, at a point ("Paste
here"), or in place of other layers ("Paste to replace").
`fig_render paste` copies up to eight of a file's top-level layers into a
blank design and scores the saved, reopened paste against the originals.

`svg::export` writes a layer as SVG the way Figma's export does: paths for
geometry, gradients and image patterns (with embedded PNGs), masks, clips,
shadows and layer blur as filters, and text as outlines. `fig_render svg`
writes SVGs (with matching PNGs) for the first page's top-level layers.

Text the editor changes is laid out again in its own fonts when they are
registered at run time (`FigFile.registerFont`: TTF, OTF, collections, WOFF,
or WOFF2, optionally under a family name), else in Inter (`fonts/`, SIL Open
Font License), embedded in the build; other text keeps Figma's own layout.
Faces are chosen by family and Figma style name ("Semi Bold Italic",
"Condensed Medium", "9pt Regular"); variable fonts get the style's `wght`,
`ital`/`slnt`, `wdth`, and `opsz`, a family split into per-script files
shares one style, and Inter fills in glyphs a font lacks. `fonts()` lists
the fonts a document uses and whether each is available. Characters carry
their own styles (Figma's `characterStyleIDs` and `styleOverrideTable`:
font, size, paints, decoration, letter spacing, line height, case); a `set`
with `textRange` styles only those characters, and saving writes the style
table back, keeping fields the engine does not model. `textGeometry` gives
the text editor each line's box and every caret stop.

`fig_render text --fonts DIR` lays the text of each file out again in the
fonts under `DIR` (a subdirectory names its fonts' family, as the web app
registers fetched fonts) and reports how far the glyphs land from Figma's
layout, per file and per family: an oracle for font selection, metrics,
kerning, and line breaking. Fonts for it stay outside the repository. With
the families' Google Fonts files, most layers land within a pixel (Roboto,
Lato, Roboto Mono, IBM Plex Mono, Roboto Condensed: 91–99%); the rest are
mostly fonts that changed since the file was made (Inter, DM Sans) and
layers whose stored layout predates their style.

Editing a layer inside an instance stores an override on the outermost
instance (keyed by guid path, as Figma does), or sets the component text
property the layer is bound to; `fig_render override` checks such an edit
survives saving on real files.

Resizing an instance, or an override that changes a layer's size, lays
the instance's layers out again with the same constraints and auto layout
code (on a temporary copy), keeping the result as the instance's derived
layout, which saving writes to `derivedSymbolData`.

## Design systems

`edit::design` holds Figma's design system workflows. Instances take
component property values (boolean, text, and instance swap, by
definition id; nested instances through overrides on the outermost one)
and switch variants by property name, which swaps to the variant whose
values match best. A swap keeps the overrides that still apply: an
override's layer is found in the new component by its place among
same-named layers, and text carried over is laid out again in the new
layer's style. "Reset all changes" drops overrides and values. Main
components get "Combine as variants" (a component set: a frame with
`isStateGroup`, values from `Prop=Value` names or from slash-separated
names), added variants and variant properties, and component properties
with defaults (which the bound layers show) and bindings
(`componentPropRefs`). A set's variant properties live three ways in a
file (variant names, `variantPropSpecs`, and the set's `VARIANT`
definitions and `stateGroupPropertyValueOrders`); edits change names and
bring the other two in line. Shared styles live on the internal canvas
(made when a file has none); a layer using one keeps the reference and
the values, editing a style updates every layer using it, and typing a
font or size into styled text detaches it, as in Figma. Saving patches the
property, variant, and style records in place, keeping fields the engine
does not model (sort positions, deleted entries) and writing Figma's
variable form of values (`varValue`) beside them. Variables (collections
with their modes, and values per mode) are read; a fill or stroke color
binds to a color variable (`colorVar`), and a frame picks a collection's
mode (`variableModeBySetMap`). As in Figma's files, bound paints keep the
resolved color, so binding and switching modes resolve it again (aliases
followed) for the layers they affect, instances' layers as overrides.
`inspect::design_info`, `inspect::local_styles`, and `inspect::variables`
describe all of this to the design panel.

## Editing together

`collab` shares edits between people as flat maps (Loro maps in the web app,
on the sync service): `figNodes` holds, per node id, the node's whole state
after an edit (every modeled property bit for bit, parent and position,
removed or not, and which fields were edited), `figBlobs` the geometry and
glyph blobs edits made (keyed by content), and `figImages` images added
during the session. Every peer opens the stored file and applies the
entries; an entry is absolute, so applying it is idempotent, entries can
arrive in any order, and concurrent edits to one node resolve
last-writer-wins. Parents' children are derived from the nodes' parent links
and positions, so concurrent moves, inserts, and deletes converge. Each peer
creates nodes in its own guid session. Undo stays local: the nodes it
restores are shared as ordinary changes. The edited-field flags accumulate
across peers, so whoever saves writes every field anyone changed, whichever
version of the file they opened; a later joiner opening a saved file and
applying the same entries gets the same design. Blobs the file started with
(`figMeta.baseBlobs`) are referenced by index, since saving keeps them in
order. `fig_render collab` edits each file as one peer and checks that a
second peer, both peers' saves, and a joiner from the saved file render
identically.

Instances have no stored children: the scene builds their sublayers from the
component, applying overrides keyed by GUID paths (outer instances win), and
uses the instance's derived sizes, transforms, and geometry. Rendering is a
CPU rasterizer over the scene; the viewer asks for 512 px tiles at the
current scale and composites them on a canvas, so a file renders
progressively and only what is visible is drawn.

## Use

```sh
cargo run -p fig_engine --features cli --release --bin fig_render -- info  FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- render --out out FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- compare --out out FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- collab FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- text --fonts DIR --verbose FILE.fig…
```

`info` prints decode statistics, `render` writes one PNG per page, and
`compare` renders the region of Figma's own embedded thumbnail and reports a
similarity score (a fidelity check that needs no Figma account). Run it over
any local collection of `.fig` files after rendering changes; third-party
files are not committed.

The browser build: `just build-fig-engine-wasm` from `apps/web` (wasm-pack,
`--target web`, SIMD enabled, the `fig-engine-wasm` profile with full LTO;
`ensure-fig-engine-wasm` rebuilds only when the crate changed).

## Tests

`cargo test -p fig_engine` builds files from scratch with `src/testing.rs`
(a kiwi encoder and a Figma-shaped test schema), so the container, schema, and
message paths are exercised end to end without third-party data.
`tests/fixtures/showcase.fig` is the synthetic file the browser fixture and
Playwright suite open; it is generated by `testing::showcase_file`, and a test
fails when it is stale (regenerate with
`cargo test -p fig_engine --lib write_showcase_fixture -- --ignored`).
