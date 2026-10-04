# docx_engine

A from-scratch Word (`.docx`) engine: it parses, paginates, renders, edits
and saves documents. The same Rust code runs natively (tests, the corpus
CLI) and as WebAssembly in the web app's DOCX editor worker
(`apps/web/src/lib/core/docx-engine`). It builds on `pptx_engine` for the
shared Office foundation: the ZIP container, OPC packaging, DrawingML
(colors, fills, geometry, charts, pictures), the font database and the
tiny-skia rasterizer. Everything Word-specific is implemented here, with no
other dependencies.

## Design

A paragraph is an attributed string: text plus spans of attributes, where
every run property element is its own attribute (`r:w:b` holds `<w:b/>`)
and non-text content (pictures, field characters, note references,
bookmarks) is an object character (U+FFFC) carrying its XML. Elements that
wrap runs (hyperlinks, tracked changes, content controls, simple fields)
are a `wrap` attribute listing them. Paragraphs sit in a tree of blocks
(paragraphs, tables, rows, cells, content controls, opaque XML) with
stable ids and fractional position keys. Offsets are UTF-16 code units,
the unit JavaScript and the CRDT use.

That shape is also the collaborative state: each block is a Loro map with
its paragraph text as a rich `LoroText`, so a keystroke is one small text
operation and two people formatting overlapping text in different ways
both win. Content the engine does not interpret stays as XML snippets and
is written back unchanged; parts an edit did not touch keep their bytes.

```
xml, units          namespace-aware XML trees and snippets, twips/EMU/points
model               blocks and content, parsing and writing, styles, numbering,
                    sections, settings, run/paragraph/table properties
document            the package, the body story, headers, footers and notes
layout              formatting (style inheritance), inline items and fields,
                    line breaking (Word's justification and tab rules), tables
                    (autofit, borders, rows across pages, repeated headers),
                    floats, frames, headers/footers, footnotes, columns,
                    sections, line numbers, and a cache keyed by block version
render              pages to tiny-skia pixmaps (whole pages or changed strips)
edit                sessions: selection, caret and hit testing, edit operations
                    as transactions with undo, lists, tables, header/footer
                    editing, tracked changes (revise.rs)
collab              the document as shared maps, applying peers' changes,
                    migrating the first collaborative format
wasm                the wasm-bindgen API used by the browser worker
```

### Editing

`Session::apply(&[EditOp], group, &FontDb)` runs operations as one
transaction and returns an `EditResult`: the collaborative changes
(text deltas, block fields, new and removed blocks, part entries), the
selection with its caret and highlight geometry, page fingerprints and the
strips of pages that changed (the editor repaints only those), and the
formatting at the selection for toolbars. Operations cover selection and
movement by character, word, line and document, typing, Enter, breaks,
deleting across paragraphs and tables, character and paragraph formatting,
styles, lists, tables (insert, rows, columns), header and footer editing
(`enterStory`/`exitStory`), tracked changes (`setTracking`,
`acceptChanges`, `rejectChanges`) and replacing search matches (`replace`,
one or all). Batches with the same group (typing) merge into one undo step;
in collaborative mode undo is the shared document's instead.

`Session::find` searches the body's visible text (field codes, deleted and
hidden text are left out; straight and typographic quotes match each
other) and returns the matches with their highlight rectangles.

While the document tracks changes (`w:trackRevisions`, shared through the
settings part), typed text is recorded as the author's `w:ins`, deleted text
as `w:del` (an author's own insertions are removed outright) and paragraph
marks as inserted or deleted. Formatting text or changing paragraph
properties keeps the formatting from before (`w:rPrChange`, `w:pPrChange`),
except in text the author inserted; changing it back drops the record.
Accept and reject resolve the selection, the revision at the caret or
everything. With markup, a bar in the left margin marks every line that
holds a change, and a list label shows its paragraph mark's revision.

Headers, footers, footnotes and endnotes are stories of their own: their
blocks get ids prefixed with the part (or note), transactions target the
active story, and an edited part (`footnotes.xml` for any footnote) is
written back as XML and shared as one entry. A click in a page's notes
area (`PageInfo::notes`) enters the note under it. `insertNote` adds a
footnote or endnote at the caret, as Word does: the reference in the text
(Footnote Reference style), the note (Footnote Text, starting with its
mark), the notes part with its separators and the styles when the document
lacks them; the caret moves into the new note.

### Collaboration

`collab` describes a document as the web app's Loro containers:
`wordBlocks` (one map per block, paragraph text as rich text), `wordParts`
(every other part; the main part is a shell with a placeholder for the
blocks), `wordRels` and `wordTypes`. `Session::from_collab` opens that
state; `apply_remote` applies peers' changes, keeping the selection on the
same text (through the exact text deltas when the caller knows them).
Collaborative sessions number new blocks from a per-peer random source so
concurrent inserts never collide. `collab::v1` migrates documents shared in
the editor's first format.

### Fonts

Layout uses `pptx_engine`'s bundled metric-compatible fonts (Liberation,
Carlito, Caladea, DejaVu and others) and its substitution table, with Noto
faces for Arabic and Hebrew (in the serif or sans-serif style of the text
around them). Native builds compile them in with the `embedded-fonts`
feature; the wasm build always does. Hosts can register more fonts.

### Right-to-left text

`layout::bidi` resolves embedding levels with the Unicode Bidirectional
Algorithm for paragraphs that are right to left (`w:bidi`) or hold
right-to-left text, then lays each line out in visual order: a
right-to-left paragraph's line is mirrored so its start (indent, list
number, first tab) is on the right, and runs against the paragraph's
direction are reversed in place; brackets mirror. Word's own behaviour is
followed where it differs: in runs marked `w:rtl`, separators do not join
numbers (`78/265` shows as `265/78`) and Latin letters and digits keep the
Latin font. Carets, hit testing, selections and the arrow keys follow the
visual order.

## Using it

```rust
use docx_engine::Document;
use docx_engine::edit::{EditOp, Session, Toggle};
use docx_engine::render::ImageCache;
use pptx_engine::font::FontDb;

let doc = Document::open(std::fs::read("contract.docx")?)?;
let fonts = FontDb::global(); // needs the `embedded-fonts` feature
let layout = doc.layout(fonts);
let mut images = ImageCache::new();
let first_page = doc.render_page(&layout, 0, 1224, fonts, &mut images); // pixels
let mut session = Session::new(doc);
session.apply(
    &[EditOp::SelectAll, EditOp::ToggleFormat { format: Toggle::Bold }],
    None,
    fonts,
)?;
std::fs::write("edited.docx", session.document().save()?)?;
```

The browser build: `just build-docx-engine-wasm` from `apps/web` (wasm-pack,
`--target web`, SIMD enabled); `just ensure-docx-engine-wasm` rebuilds only
when sources changed, and `bun run dev` runs it.

## Testing

- `cargo test -p docx_engine` runs the unit tests: parsing and writing,
  layout (lines, tables, floats, frames, headers, notes, fields), editing,
  header/footer editing, tracked changes and the collaborative state.
- The `docx_corpus` CLI (`--features cli`) renders documents, scores them
  against LibreOffice and Word reference renders (SSIM and page counts, with
  an HTML report) and dumps line positions for line-break comparisons. The
  corpus is listed in [tests/corpus](tests/corpus/README.md).
- The web editor has Playwright tests against the real sync service:
  `apps/web/src/features/block-write/browser-test`.

Current state (61 documents, 36 of them legal; references rendered with the
engine's fonts): against Word's own PDF exports (18 documents) mean SSIM
0.84 with equal page counts for all 18; against LibreOffice 24.2 (61
documents) mean SSIM 0.66 with equal page counts for 42. Page SSIM is
strict: a line that wraps one word differently shifts everything below it,
so the page counts are the better summary. LibreOffice is a reference, not ground truth;
where Word PDFs exist they decide.

## Known gaps

- Text: Arabic joins through the Unicode presentation forms (contextual
  letter shapes and the lam-alef ligatures), without OpenType mark
  positioning; other complex scripts (Indic, Thai) are not shaped. Explicit
  bidi embedding characters are ignored (Word documents use run and
  paragraph properties instead). No automatic hyphenation (soft hyphens are
  honoured).
- Layout: no vertical text, no text wrapping around tight polygon wraps
  (square wrap is used), no balancing of continuous-section columns.
- Fields are shown with their cached results, except page numbers, which
  are computed; a table of contents is not regenerated.
- Editing does not create text boxes or pictures and does not edit inside
  text boxes (it keeps them); comments are Macro threads anchored in the
  body. Undoing a new footnote removes its reference; the empty note stays
  in the notes part, unreferenced.
- Two people editing the same footnote or endnote part at once: the last
  write of the part wins, as for headers and footers.
- Tracked changes show without balloons (formatting changes only get a
  change bar); table property changes (`w:tcPrChange`, `w:tblPrChange`)
  are not recorded.
- Two people editing the same header or footer at once: the last write of
  the part wins.
