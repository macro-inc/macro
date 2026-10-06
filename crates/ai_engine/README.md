# ai_engine

A from-scratch Illustrator (`.ai`) engine: it reads Illustrator's
PDF-based files (and any PDF), turns their pages into an editable model of
artboards, layers, groups, paths, text, and images, draws any part of the
canvas at any scale, applies edits with undo, shares edits between people
editing together, and saves files Illustrator and every PDF reader open.
The same Rust code runs natively (tests, the `ai_render` CLI, the AI tools,
search indexing) and as WebAssembly in the web app's Illustrator editor
workers (`apps/web/src/lib/core/ai-engine`).

Third-party code is limited to small libraries: `tiny-skia` (rasterizing),
`miniz_oxide` (deflate), `png` and `zune-jpeg` (images), `skrifa`
(TrueType, CFF, and Type 1 outlines through its PostScript reader), and
`serde`. The PDF reader and writer, content interpreter, fonts, color
spaces, functions, shadings, images, model, editing, saving, and
collaboration are implemented here; text the editor lays out uses the font
registry `fig_engine` shares.

## The format

Since Illustrator CS, an `.ai` file is a PDF. Its pages are the artboards
(one page per artboard when the file was saved with "Create PDF Compatible
File"), Illustrator's top-level layers are optional content groups (each
layer's content is marked `/OC /MCn BDC … EMC`, listed in panel order in the
catalog's `OCProperties`), clipping masks are clipping paths around what
they clip, groups with opacity are transparency group forms, and text is
text objects in embedded (often subset) fonts. Illustrator also keeps its
own native copy of the artwork as private data (`PieceInfo` →
`AIPrivateData`, compressed PostScript-like streams); it reads that copy
rather than the PDF when it opens the file. Files from Illustrator 8 and
earlier are PostScript and are not read.

## Design

```
pdf          objects, cross-reference tables and streams, object streams,
             repair of damaged files, filters, content streams, writing
             (pdf/lexer, parse, xref, repair, pages, filter, content, write)
font         PDF fonts: Type 1, CFF, TrueType, OpenType, Type 3, CMaps,
             encodings, the glyph list, standard-14 metrics, stand-ins
color        color spaces to sRGB (device, calibrated, Lab, ICC by
             component count, indexed, separation, DeviceN)
function     sampled, exponential, stitching, and PostScript functions
shading      the seven shading types, drawn into pixels
image        image XObjects and inline images: every depth, decode arrays,
             masks, JPEG (CMYK too), CCITT fax
interp       the content interpreter: graphics state, clipping, text
             positioning, forms, Type 3 glyphs, reported to a sink
build        a file into the model (the sink that builds it)
model        artboards, layers, groups (clip groups), paths, text, images,
             raw content; each object remembers the operators that drew it
render       the model drawn with tiny-skia; raw content through the
             interpreter (render/content: patterns, soft masks, groups)
text         layout of text the editor changed (fig_engine's fonts)
edit         operations and undo/redo (edit/nodes, edit/tree, edit/shapes)
save         writing the document as a PDF-based `.ai` (save/emit, text,
             paint, resources, objects)
marks        marked content the engine writes so saved files read back
             (groups, edited text, masked paths, hidden objects)
collab       editing together: node states as CRDT map entries
inspect      layers panel rows, node properties, hit tests, marquees, fonts
describe     documents summarized for AI agents and search
wasm         the web app's API (`AiFile`)
```

### Reading

`build::open` interprets every page and builds the model. Pages become
artboards placed side by side on one canvas (artboard = `TrimBox`, else
`CropBox`, else `MediaBox`; page rotation shown). Optional content groups
become layers in the file's panel order (empty and hidden layers too).
Clipping paths become clip groups: clips are told apart by which `W` set
them (`interp::ClipPath::serial`), so objects drawn under one clip share
one group however `q`/`Q` nest; clips of the page's own box are dropped
(they clip nothing on the artboard; content past the artboard shows on the
pasteboard as in Illustrator). Forms become groups: a transparency group
keeps its opacity, blend mode, isolation, and knockout; its bounding box
clip is dropped when it clips nothing; a form that only wraps one object is
replaced by it.

Each painted path becomes a path object in its own user space (the object's
transform maps it to the canvas, so moves change one matrix and points stay
exact) with its fill and stroke: colors keep their space (gray, RGB, CMYK,
spot), axial and radial shading patterns become gradients. Text blocks
become text objects: the glyphs as the file placed them (font, codes,
positions, paints, grouped in runs) plus the characters, font family and
style, size, line height, and tracking, so the text is editable and shows
exactly as the file drew it until it is edited. Images become image objects.
What the model has no equivalent for (soft-masked painting, tiling
patterns, mesh shadings, `sh`, stencil masks, Type 3 text) becomes raw
content, drawn by running its operators and moved as a whole.

Every object keeps its source: the operators that drew it, the CTM, the
operators that set the rest of its graphics state (each with the resource
dictionary it names things in, since state set in a page applies inside the
forms it draws), and its resources.

### Drawing

`render::Renderer` draws a view of the canvas: artboards, then layers. Paths
fill and stroke with tiny-skia (gradients as shaders, non-extended ends
clipped); groups clip and composite through layers when they have opacity
or a blend mode; text from files draws the file's glyph outlines; edited
text is laid out and drawn; images decode once and are kept, with halved
copies for drawing small. Raw content runs through the interpreter into a
canvas with a clip stack, transparency groups, soft masks (luminosity and
alpha, with transfer functions), shading and tiling patterns (cells drawn at
device resolution), shadings, images, and glyph outlines.

Fidelity, measured with `ai_render compare` against poppler at 72 dpi on
sample Illustrator files: mean channel difference under 0.4 for vector
artwork and under 2 for files with photos and text (text antialiasing and
CMYK conversion account for the rest).

### Editing

Operations (`edit::Op`, JSON from the editor) name nodes by id and run as
undoable steps; a batch that fails leaves the document as it was. Edit
flags record what changed. Transforms change node transforms (groups pass
them to their contents and clips); fills, strokes, paths, and text change
the model; there are creation (paths, rectangles, ellipses, polygons and
stars, text), deletion, duplication, moves in the tree, grouping, clipping
masks, layers, text to outlines, boolean operations (fig_engine's), artboards,
and placed images.

### Saving

An unedited document saves byte for byte. Otherwise the file is written
again as a PDF: one page per artboard (the original page boxes and rotation
when the artboard kept its size), layers as optional content groups (hidden
and locked ones listed off and locked), groups as marked content
(`/MacroGroup` with the name; transparency groups as forms), and each
object either as the file drew it — its operators, renamed into the page's
resources, with any move written in front as a `cm` — or, when it was
redrawn, from the model. Edited text is written as outlines (so every
application shows it as laid out here) with an invisible copy of its
characters (search and copy work) inside `/MacroText` marked content that
reads back as editable text. Hidden objects go in an optional content group
that is off. A gradient with transparent stops is painted under a soft
mask of its stops' opacities, as Illustrator writes it, inside `/MacroPath`
marked content that reads back as the path. Illustrator's private data is
left out, so Illustrator reads
the edited PDF instead of its stale copy. Saving every sample file after
moving everything away and back draws identically in poppler.

### Collaboration

Everyone opens the stored file (node ids are given in reading order, so
they agree) and applies shared entries: node states (properties, transform,
parent and fractional position, and the node's content when it differs from
the stored file), the artboards, and images placed during the session. New
nodes get ids in the creator's session (`session << 20`). See
`collab.rs`.

## The CLI

`cargo run -p ai_engine --features cli --release --bin ai_render -- <command>`:

- `info <files…> [--tree]`: artboards, layers, object counts, warnings, open
  time.
- `render <file> [--out dir] [--scale s]`: each artboard as PNG.
- `roundtrip <files…> [--out dir]`: moves everything away and back, saves,
  reopens, and compares renders.
- `compare <file> <refs-dir> [--scale s] [--out dir]`: renders against
  reference PNGs (`pdftoppm -cropbox -r 72 -png file.ai refs/name`).

## Known gaps

- Illustrator 8 and earlier (PostScript) files are not read.
- Artboard positions come from page order (side by side), not from
  Illustrator's private data; an object spanning two artboards is drawn on
  each page and reads back twice.
- Edited text is saved as outlines with invisible text; Illustrator opens it
  as outlines, the engine as text.
- Knockout groups draw as plain transparency groups.
- Live effects, symbols, and other Illustrator-only constructs show as they
  were drawn in the PDF.
