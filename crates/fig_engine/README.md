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
materialized. Opening a file decodes each node change in place (strings and
bytes stay in the message, nested values go to tables reused for the next
node change) and builds the node's properties from it; what is built from a
field is shared with every node change whose field has the same bytes, so
instances of one component share their overrides and derived layout, and
repeated paints, effects, text, and names are stored once.

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
kiwi             schema and message decoding (allowlisted fields, by-name access;
                 kiwi/flat: in-place decoding and sharing for opening files)
decode           kiwi messages → `model::Props` (paints, effects, text, symbols)
document         nodes, the tree, pages, blobs (geometry parsed lazily, once)
scene            one page with instances expanded: overrides, component
                 properties, swaps, shared styles, world transforms, bounds
render           tiles: fills, strokes (inside/outside via clipping), masks,
                 blend modes, isolation, effects (shadows, blurs), images, text
inspect          layer rows, frames, hit tests, marquee, node info, search, SVG
                 outlines; a page's prototype (inspect/prototype)
describe         a design summarized for AI agents and search: pages, frames,
                 their text and components, the design system; text by page
edit             edit operations, undo/redo, fractional-index positions;
                 auto layout (stacks re-laid out after edits); booleans,
                 flatten, and vectors (edit/shapes); pasting (edit/paste)
collab           editing together: node states as CRDT map entries
boolean          path union, subtract, intersect, and exclude
vector           vector networks: the `vectorNetworkBlob` format, fill
                 regions and stroke paths, conversion from outlines
svg              SVG export of a layer, as Figma writes it
export           export files: PNG, JPG (its own encoder), SVG, PDF (vector), ZIPs
text             text layout for edited text: fonts (bundled Inter, registered
                 TTF/OTF/WOFF/WOFF2, variable axes), kerning, wrapping,
                 per-character styles, caret geometry for the editor
save             writing `.fig`: patch edited records, splice the rest; blank
                 files; the clipboard document (save/clipboard)
library          team libraries: keys and versions, what changed since a
                 publish, packages of assets for other files
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
long as compressing it: the new message is deflated into the archive as it
is written, so it is never held whole beside the original. `fig_render roundtrip` checks that edited, saved,
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

## Team libraries

`library` and `edit::library` hold Figma's team libraries: a file
publishes its components, component sets, styles, and variables, and other
files use them. `Op::PublishLibrary` gives every asset a key (40 hex digits
from the library's document id and the asset's id, kept once given) and a
version, a hash of the modeled properties of its layers and the versions of
the components, styles, and variables it uses (geometry, glyphs, and
instance layout Figma derives are left out; numbers are taken at the
precision files store them, so versions survive saving). They are written
in Figma's fields: `isSymbolPublishable`/`isPublishable`,
`sharedSymbolVersion`/`version`, and `publishedVersion`; names starting
with `_` or `.` stay private (keyed, unlisted). The document node records
what was published and the publisher's note as Macro `pluginData`
(`pluginID` `macro`, other plugins' entries kept), so `library::status`
lists new, changed, and removed assets for "Changes to publish", and
`library::published` the assets a file using the library sees.

`library::package` writes the assets a file asks for, a variant bringing
its set, with everything they use, as a copy (the clipboard format, on its
internal page). `History::import_library` copies them onto the file's
internal canvas as Figma does: components stay components with their key,
`sourceLibraryKey` (the library's document id), `publishID` (their id
there), and the version they were copied at, and `componentKey` on
components. Every id in the package (nodes, property definitions, modes,
override paths, the records' `GUID`s) moves into a session range of its
own for that library (sessions from 2³¹, which files and people editing
together do not use), the same each time, so a later version lands on the
same nodes: `update` replaces a copy's layers in place, instances keep their
overrides, and instances of updated components (and of the file's own
components holding them) are laid out again, overridden text included;
updated styles and variables reach the layers using them. Copies already
in the file are kept unless updating, components a removed variant's
instances still show stay, and `then` ops (`key:<key>` names an asset)
place an instance, apply a style, or bind a variable in the same undoable
step. Records travel translated into the file's schema, as pasting does;
schemas without the library fields get them on save. `Op::SetLibraries`
stores the libraries a file uses on its document node.
`fig_render library` publishes each file, checks nothing is left to
publish after saving and reopening, places up to eight of its components
in a blank design through packages, and compares the saved instances'
pixels with the library's components.

## Prototypes

Prototype interactions decode into `Props::interactions` from
`prototypeInteractions` (each a trigger, `PrototypeEvent.interactionType`,
and its `PrototypeAction`s: `connectionType` `INTERNAL_NODE`/`URL`/`BACK`/
`CLOSE`, `navigationType` `NAVIGATE`/`OVERLAY`/`SWAP`/`SCROLL_TO`/
`SWAP_STATE`, `transitionNodeID`, `transitionType`, `transitionDuration`,
`easingType`, `connectionURL`), or from the single connection older files
keep on the node (`transitionNodeID`, `transitionType`…). Absent enums take
Figma's defaults (a click, navigate, instant). Flow starting points
(`prototypeStartingPoint`: name, description, position) and overlay settings
(`overlayPositionType`, `overlayBackgroundInteraction`,
`overlayBackgroundAppearance`) are read too, and a page's
`prototypeStartNodeID` for files from before flows. Instance sublayers carry
their component's interactions with overrides applied.
`inspect::prototype::prototype` lists a page's flows, screens (top-level
frames and frames directly in top-level sections), and every visible layer
with interactions, in paint order, which the web app plays in present mode.

`Op::SetInteractions` replaces a layer's interactions (an interaction sent
back with its id, and each action at the same index, keeps what the editor
does not show) and `Op::SetFlowStart` adds, renames, or removes a frame's
flow (`edit::flags::PROTOTYPE`). Saving writes `prototypeInteractions`
starting from the file's own records (conditions, variables, and easing
curves survive), drops the legacy fields once a node has interactions, and
writes `prototypeStartingPoint`; a file whose schema has no prototype types
(designs made in Macro) gets Figma's, by name, when an edit adds any.
`fig_render prototype` reads each file's prototype, edits it as the
Prototype tab does, saves, reopens, and checks the result reads the same.
`testing::prototype_file` builds `tests/fixtures/prototype.fig`, the browser
fixture's click-through prototype (regenerate with
`cargo test -p fig_engine --lib write_prototype_fixture -- --ignored`).

## Handoff and layout aids

Layers' export presets (`exportSettings`: format, suffix, scale or fixed
width or height, SVG outline text and `svgIDMode`, contents only, absolute
bounds, and JPEG `quality` where the schema has it), frames' layout grids
(`layoutGrids`: square grids, columns, and rows with count, "Auto" stored as
`i32::MAX`, stretch/min/center/max alignment, offset, section size, gutter,
and color), and the ruler guides of pages and frames (`guides`: axis,
offset, and id) are read into `Props`, edited with `Op::SetExports`,
`Op::SetLayoutGrids`, and `Op::SetGuides` (`edit::flags::EXPORTS`,
`LAYOUT_GRIDS`, `GUIDES`), shared like every other field, and saved over the
record's own entries, so fields the engine does not model (a preset's color
profile, variables bound to a grid's values) survive. Designs made in Macro
before these fields existed get Figma's types, by name, when an edit needs
them. Grids and guides are never drawn by the renderer or exports;
`inspect::layout_aids` hands them to the canvas overlay.

`export` makes the files: PNG (the renderer), JPG (`export::jpeg`, a
baseline encoder with libjpeg's quality scaling, over white), SVG (`svg`,
with outline text off writing `<text>` elements and layer `id`s on
request), and PDF (`export::pdf`). The PDF writer draws paths, solid fills,
linear and radial gradients (shadings), image fills (JPEGs embedded as they
are), strokes, frame clipping, opacity, and outlined text as vectors; a
layer PDF cannot draw the same way (effects, masks, blend modes, angular or
diamond gradients, gradients with varying alpha, tiled or adjusted images,
translucent groups) is drawn by the renderer at 2x and placed as an image,
so the rest stays vector. Files are named as Figma names them
(`Icon@2x.png`, `/` in a layer name makes ZIP folders), several come as a
stored ZIP, and `export::frames_pdf` is "Export frames to PDF" (a page's
top-level frames, a page each). `fig_render pdf` writes that PDF for each
file's first page.

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
cargo run -p fig_engine --features cli --release --bin fig_render -- prototype FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- library FILE.fig…
cargo run -p fig_engine --features cli --release --bin fig_render -- text --fonts DIR --verbose FILE.fig…
```

`info` prints decode statistics, `bench` times opening (with the heap it
takes; `--open` stops there), scene builds, and page and tile renders,
`render` writes one PNG per page, and
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
