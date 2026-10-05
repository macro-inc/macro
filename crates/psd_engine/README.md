# psd_engine

A from-scratch Photoshop (`.psd`, `.psb`) engine. It reads Photoshop
files into an editable model of layers, composites them the way Photoshop
does, applies edits with undo, and shares edits between people editing
together. It saves files that keep everything it does not model.

The same Rust code runs in two places:

- natively: tests, the `psd_render` CLI, the AI tools, and search indexing;
- as WebAssembly: the web app's Photoshop editor worker
  (`apps/web/src/lib/core/psd-engine`).

Third-party code is limited to small libraries:

- `tiny-skia` for vector rasterizing;
- `miniz_oxide` for deflate;
- `png`;
- `serde`.

`fig_engine` supplies the font registry, glyph outlines, image decoding,
the JPEG encoder, and the fractional positions collaboration orders layers
by. Everything else is implemented here: the file format, the descriptor
and text-engine codecs, color conversion, compositing, effects, filters,
painting, selections, transforms, saving, and collaboration.

## The format

A PSD file has five parts:

1. a header;
2. color mode data;
3. image resources (resolution, guides, thumbnail, ICC profile, and so on);
4. layer and mask information;
5. the merged image.

The layer and mask information holds three things:

- **Layer records:** bounds, blend mode, opacity, mask, name, and tagged
  blocks.
- **Each record's channel data:** raw, RLE, or zip.
- **Document-level tagged blocks.**

Most of what makes a modern file are those tagged blocks:

- action descriptors (layer styles, fill layers, smart objects, artboards);
- the text engine's data (text layers);
- binary adjustment blocks.

Groups are records too. A group's own record comes after its children,
and a hidden divider record comes before them. PSB, the large-document
variant, widens some lengths to 64 bits.

## Design

```
binary       big-endian reading and writing
file         a file split into its parts and joined back, byte for byte
             (file/read, file/write)
channels     channel compression (raw, RLE, zip, zip with prediction)
color        any mode and depth to 8-bit straight RGBA and back
resources    the image resources the model reads (resolution, guides,
             thumbnail, ICC, version info)
codec        tagged blocks: descriptors, the text engine's data, and each
             kind of content built on them (effects, fills, adjustments,
             vector masks, text, smart objects, patterns, artboards)
model        the document: layers in an arena, groups, masks, styles,
             adjustments, text, gradients, artboards, edit flags
document     opening: records into layers, blocks into typed properties
raster       tiled RGBA and gray rasters (shared tiles), selections
render       the compositor (render/composite, layer, blend, effects,
             fill, adjust, vector, plane, cache)
text         laying out and drawing text layers the editor changed
edit         operations and undo (edit/ops, layers, canvas, pixels,
             paint, select, transform, filters)
save         writing the document back (save/record)
collab       editing together: layer states and pixel tiles as CRDT
             entries
inspect      layers panel rows, layer details, hit tests, samples
describe     documents summarized for AI agents and search
wasm         the web app's API (`PsdFile`)
```

### Reading

`document::open` splits the file, then builds the model:

- Records become layers, and dividers become groups.
- Blocks become typed properties:
  - names, ids, and locks;
  - styles (`lfx2`, `lmfx`, `lfxs`, and the legacy `lrFX`);
  - Blend If ranges;
  - vector masks;
  - fill and shape layers;
  - adjustment layers;
  - text;
  - smart object placements;
  - artboards.
- Channels become RGBA rasters, and masks become gray rasters.

A block the engine cannot decode leaves its layer showing its stored
pixels, and saving keeps that block unchanged.

The merged image becomes the composite shown wherever nothing has been
edited. Photoshop blends a transparent document's merged image over white,
so the engine unblends it on read.

Layers stay in an arena and refer to each other by index. Removed layers
stay in the arena too, so that undo and other people's edits can bring
them back.

### Compositing

`render::Renderer` composites any rectangle at any power-of-two zoom. It
follows Photoshop's rules for:

- all 27 blend modes;
- opacity and fill opacity, including the eight modes where fill opacity
  applies inside the blend;
- pixel masks (density, feather) and vector masks (per-shape fill rules,
  combined shapes);
- clipping groups, blended as a group or not;
- pass-through and isolated groups, knockout, and artboards (background,
  and content cut to the board);
- fill layers, and shape layers with their strokes;
- adjustment layers;
- Blend If.

It also draws layer styles:

- drop and inner shadows;
- outer and inner glows;
- bevel and emboss;
- satin;
- color, gradient, and pattern overlays;
- strokes;
- multiple instances of each.

Gradients use the file's interpolation method:

| Method | How colors mix |
| --- | --- |
| classic | the stored sRGB values |
| perceptual | in Oklab, eased by the smoothness |
| linear | in linear light |
| smooth | in Oklab, evenly between stops |

Work is done in premultiplied `f32`. Below full size, layers and the
stored image are box-filtered by halves and cached by tile identity.

Fidelity is measured with `psd_render compare`, which composites the
layers and compares the result with the merged image Photoshop stored. On
131 files from ag-psd's test suite:

- the median mean channel difference is 0.01;
- most of the rest is under 1;
- the largest differences are:
  - noise gradients (Photoshop's generator is not reproduced; the engine
    draws seeded stops);
  - antialiasing at the edges of strokes and vector shapes;
  - a few effect edge cases.

### Editing

Operations (`edit::Op`, sent from the editor as JSON) name layers by id.
`History` runs each batch as one undoable step. A batch that fails partway
leaves the document as it was.

There are operations for:

- **Layer properties:** opacity, blend, visibility, locks, and so on.
- **Layer structure:** creating, deleting, duplicating, moving, grouping,
  merging, and flattening.
- **Rasterizing.**
- **Moving and transforming:** translate, free transform, flip, and rotate.
- **Pixel tools:** brush, pencil, and eraser with pressure; fill; paint
  bucket; and the gradient tool.
- **Selections:** marquees, lasso, magic wand, and the selection algebra.
- **Filters:** Gaussian blur, unsharp mask, noise, mosaic, motion blur,
  adjustments, and desaturate.
- **Masks and vector masks.**
- **Layer content and styles:** text, fills, adjustments, styles, and
  Blend If.
- **The canvas:** crop, canvas size, image size, rotate, flip, and
  conversion to RGB.
- **Guides, resolution, and placing images.**

Every change sets the layer's edit flags (`model::flags`), so saving
rewrites only what changed.

### Saving

An unedited document saves byte for byte. Otherwise:

- Unedited layers keep their records and channel data exactly.
- Edited layers keep their other blocks (including ones the engine does
  not model), and only the parts their flags name are rewritten.
- New layers get fresh records.
- The merged image and thumbnail are rendered again, so that other
  applications show the edits.

In the round-trip test, every layer of every corpus file is moved away and
back, then the file is saved and reopened. All 173 files reopen with
identical layers and composites.

### Collaboration

Each person opens the stored file, then applies the shared entries:

- **Layer states:** properties, parent, fractional position, anchor, and
  pixel generation. These are absolute, so concurrent edits to one layer
  resolve last-writer-wins.
- **Pixel tiles:** 256-pixel tiles on each layer's own grid. A brush
  stroke shares only the tiles it touched.

Moving a layer changes its anchor and no tiles. Replacing pixels
wholesale starts a new generation, which keeps strokes on the old pixels
from landing on the new ones. See `collab.rs`.

## The CLI

```
cargo run -p psd_engine --features cli --release --bin psd_render -- <command>
```

| Command | What it does |
| --- | --- |
| `info <files…> [--tree] [--json]` | Size, mode, depth, layer count, warnings, and open time. `--tree` prints the layer tree; `--json` prints each layer's kind, effects, vector mask, and Blend If ranges. |
| `render <file> --out file.png [--level n]` | Composites the layers, not the stored image. |
| `compare <files or dirs…> [--out dir]` | Composites the layers and compares the result with the stored merged image. Writes ours, stored, and diff PNGs. |
| `roundtrip <files or dirs…> [--out dir]` | Moves every layer away and back, saves, reopens, and compares. |

The corpus tests are `#[ignore]` and read the files under
`PSD_CORPUS_DIR`, for example a checkout of ag-psd's `test` directory.
Run them with:

```
cargo test -p psd_engine --release -- --ignored
```

## Known gaps

- Editing works on 8-bit RGBA. Saving 16- and 32-bit documents writes
  edited layers at their depth from 8-bit values.
- CMYK, Lab, and other non-RGB documents display and save. Changing their
  canvas size needs a conversion to RGB first.
- Noise gradients are approximated.
- Text that has been edited is laid out by the engine. Until a text layer
  is edited, it shows the pixels Photoshop stored for it.
- Smart objects show their stored pixels, and transforming one transforms
  those pixels.
- 3D layers, video layers, and filter effects other than the stored
  result are kept but not drawn live.
