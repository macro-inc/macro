# fig_engine

A from-scratch Figma (`.fig`) engine: it decodes design files, expands
component instances, rasterizes any region at any scale, answers the
editor's questions (layers, hit tests, node properties, search), applies
edits with undo, and saves `.fig` files. The same Rust
code runs natively (tests, the `fig_render` CLI) and as WebAssembly in the web
app's `.fig` viewer workers (`apps/web/src/lib/core/fig-engine`).

Third-party code is limited to small libraries: `tiny-skia` (rasterizing),
`miniz_oxide` and `ruzstd` (deflate and zstd), `png`, `zune-jpeg`, `gif`, and
`image-webp` (image fills), and `serde`. The ZIP reader, kiwi decoder, scene
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
fonts or an auto-layout engine.

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
                 auto layout (stacks re-laid out after edits)
collab           editing together: node states as CRDT map entries
text             text layout for edited text (bundled Inter, kerning, wrapping)
save             writing `.fig`: patch edited records, splice the rest; blank files
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
alignment, min and max sizes, and hugging, which carries the change up
through hugging parents. `fig_render relayout` re-lays out every stack in a
file and reports the frames placed differently from Figma's own layout.

Text the editor changes is laid out again with Inter (`fonts/`, SIL Open
Font License), embedded in the build, or a font registered at run time;
other text keeps Figma's own layout.

Editing a layer inside an instance stores an override on the outermost
instance (keyed by guid path, as Figma does), or sets the component text
property the layer is bound to; `fig_render override` checks such an edit
survives saving on real files.

Resizing an instance, or an override that changes a layer's size, lays
the instance's layers out again with the same constraints and auto layout
code (on a temporary copy), keeping the result as the instance's derived
layout, which saving writes to `derivedSymbolData`.

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
```

`info` prints decode statistics, `render` writes one PNG per page, and
`compare` renders the region of Figma's own embedded thumbnail and reports a
similarity score (a fidelity check that needs no Figma account). Run it over
any local collection of `.fig` files after rendering changes; third-party
files are not committed.

The browser build: `just build-fig-engine-wasm` from `apps/web` (wasm-pack,
`--target web`, SIMD enabled; `ensure-fig-engine-wasm` rebuilds only when the
crate changed).

## Tests

`cargo test -p fig_engine` builds files from scratch with `src/testing.rs`
(a kiwi encoder and a Figma-shaped test schema), so the container, schema, and
message paths are exercised end to end without third-party data.
`tests/fixtures/showcase.fig` is the synthetic file the browser fixture and
Playwright suite open; it is generated by `testing::showcase_file`, and a test
fails when it is stale (regenerate with
`cargo test -p fig_engine --lib write_showcase_fixture -- --ignored`).
