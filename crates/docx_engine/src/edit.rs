//! Editing: a [`Session`] holds a document, its layout and a selection.
//!
//! Edit operations ([`EditOp`]) run as transactions over the body's blocks.
//! Each returns an [`EditResult`]: the collaborative changes it made (text
//! deltas and block fields for the shared maps), the selection afterwards
//! with its geometry, the formatting at the selection, and page
//! fingerprints so the caller repaints only pages that changed.

mod format;
mod geometry;
mod lists;
mod table;
mod text;
mod txn;
mod xmledit;

#[cfg(test)]
mod test;

pub use format::{Alignment, ParaPatch, RunPatch, Spacing, Toggle};
pub use geometry::{CaretRect, PageRect, ViewIndex};
pub use txn::{BlockRecord, Change, Step, content_delta};

use crate::document::Document;
use crate::layout::format::{Formats, ParaFormat, TableCtx};
use crate::layout::{Item, Layout, LayoutCache, LayoutOptions, Page, ParaBox};
use crate::model::block::{BlockId, BlockKind};
use crate::model::content::{Attrs, OBJECT_CHAR, key, utf16_len};
use crate::model::props::Align;
use crate::xml::SnippetContext;
use pptx_engine::font::FontDb;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use txn::Txn;
use xmledit::Element;

fn is_false(v: &bool) -> bool {
    !*v
}

/// A position in the body: a paragraph and a UTF-16 offset in its content.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pos {
    /// The paragraph.
    pub block: BlockId,
    /// Offset in its content (UTF-16 code units).
    pub offset: usize,
    /// At a line wrap, show the caret at the end of the earlier line.
    #[serde(default, skip_serializing_if = "is_false")]
    pub upstream: bool,
}

impl Pos {
    /// A position.
    pub fn new(block: BlockId, offset: usize) -> Self {
        Self {
            block,
            offset,
            upstream: false,
        }
    }

    fn same_place(&self, other: &Pos) -> bool {
        self.block == other.block && self.offset == other.offset
    }
}

/// A selection: the anchor stays put while the focus moves.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    /// Where the selection started.
    pub anchor: Pos,
    /// Where the caret is.
    pub focus: Pos,
}

impl Selection {
    /// A caret.
    pub fn caret(pos: Pos) -> Self {
        Self {
            anchor: pos.clone(),
            focus: pos,
        }
    }

    /// Whether the selection is a caret.
    pub fn is_collapsed(&self) -> bool {
        self.anchor.same_place(&self.focus)
    }
}

/// How far a caret movement or deletion goes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    /// One character.
    #[default]
    Char,
    /// One word.
    Word,
    /// One line up or down.
    Line,
    /// To the start or end of the line.
    LineBoundary,
    /// To the start of the paragraph (or the next one).
    Paragraph,
    /// To the start or end of the document.
    Document,
}

/// A manual break.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BreakKind {
    /// A line break within the paragraph.
    Line,
    /// A page break.
    Page,
    /// A column break.
    Column,
}

/// A kind of list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListKind {
    /// Bullets.
    Bullet,
    /// Numbers.
    Number,
}

/// One edit operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum EditOp {
    /// Sets the selection.
    Select {
        /// Anchor.
        anchor: Pos,
        /// Focus.
        focus: Pos,
    },
    /// Moves the caret, or extends the selection.
    Move {
        /// How far.
        #[serde(default)]
        unit: Unit,
        /// Forward (right/down) or backward.
        forward: bool,
        /// Extend the selection instead of moving the caret.
        #[serde(default)]
        extend: bool,
    },
    /// Selects the whole body.
    SelectAll,
    /// Selects the word at a position.
    SelectWord {
        /// Where.
        at: Pos,
    },
    /// Selects the paragraph at a position.
    SelectParagraph {
        /// Where.
        at: Pos,
    },
    /// Types text over the selection (newlines start paragraphs).
    InsertText {
        /// The text.
        text: String,
    },
    /// Splits the paragraph at the caret (Enter).
    InsertParagraph,
    /// Inserts a manual break.
    InsertBreak {
        /// Which.
        kind: BreakKind,
    },
    /// Deletes the selection, or one unit beside the caret.
    Delete {
        /// Forward (Delete) or backward (Backspace).
        forward: bool,
        /// How much, for a caret.
        #[serde(default)]
        unit: Unit,
    },
    /// Turns a character format on or off for the selection.
    ToggleFormat {
        /// Which format.
        format: Toggle,
    },
    /// Sets character formatting on the selection.
    SetFormat {
        /// The change.
        #[serde(flatten)]
        patch: RunPatch,
    },
    /// Removes direct character formatting from the selection.
    ClearFormat,
    /// Sets paragraph formatting on the selected paragraphs.
    SetParagraph {
        /// The change.
        #[serde(flatten)]
        patch: ParaPatch,
    },
    /// Applies a paragraph style to the selected paragraphs.
    SetStyle {
        /// Style id.
        style: String,
    },
    /// Makes the selected paragraphs a list of `kind`, or plain paragraphs
    /// when they already are one.
    ToggleList {
        /// Bullets or numbers.
        kind: ListKind,
    },
    /// Moves list items a level deeper (or out), or changes the left indent.
    Indent {
        /// Deeper (true) or shallower.
        forward: bool,
    },
    /// Inserts a table at the caret.
    InsertTable {
        /// Rows.
        rows: usize,
        /// Columns.
        cols: usize,
    },
    /// Inserts a row next to the caret's.
    InsertRow {
        /// Below (true) or above.
        below: bool,
    },
    /// Inserts a column next to the caret's.
    InsertColumn {
        /// Right (true) or left.
        right: bool,
    },
    /// Deletes the caret's table row.
    DeleteRow,
    /// Deletes the caret's table column.
    DeleteColumn,
    /// Deletes the caret's table.
    DeleteTable,
}

/// A page's size and a fingerprint of what it shows.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    /// Width (points).
    pub width: f32,
    /// Height (points).
    pub height: f32,
    /// Changes whenever the page's content does (hex).
    pub fingerprint: String,
}

/// Formatting at the selection, for toolbars.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatState {
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Underlined.
    pub underline: bool,
    /// Struck through.
    pub strike: bool,
    /// Superscript.
    pub superscript: bool,
    /// Subscript.
    pub subscript: bool,
    /// Font family.
    pub font: Option<String>,
    /// Size (points).
    pub size: Option<f32>,
    /// Text color (`RRGGBB`), when not automatic.
    pub color: Option<String>,
    /// Paragraph style id.
    pub style: Option<String>,
    /// Paragraph style name.
    pub style_name: Option<String>,
    /// Paragraph alignment.
    pub align: Option<Alignment>,
    /// Whether the paragraph is in a list.
    pub list: bool,
    /// Whether undo is possible.
    pub can_undo: bool,
    /// Whether redo is possible.
    pub can_redo: bool,
}

/// What an operation did.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    /// Whether the document changed.
    pub changed: bool,
    /// The changes for the collaborative maps.
    pub changes: Vec<Change>,
    /// The selection afterwards.
    pub selection: Selection,
    /// The selection's ends in document order.
    pub range: Range,
    /// The caret (at the focus).
    pub caret: Option<CaretRect>,
    /// Selection highlight rectangles.
    pub rects: Vec<PageRect>,
    /// Pages, when the layout changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<PageInfo>>,
    /// Where pages changed since the previous result, when the layout changed.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bands: Vec<Band>,
    /// Formatting at the selection.
    pub format: FormatState,
}

/// A selection's ends in document order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    /// The start.
    pub from: Pos,
    /// The end.
    pub to: Pos,
}

/// A change other peers made, as the shared containers now hold it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum RemoteChange {
    /// A block as it now is (new or changed).
    Block {
        /// The block.
        block: BlockRecord,
    },
    /// A block that no longer exists.
    Remove {
        /// Block id.
        id: BlockId,
    },
    /// An entry of the parts, relationships or content types maps.
    Entry {
        /// The map.
        container: String,
        /// The key.
        key: String,
        /// The value (`None` = deleted).
        value: Option<String>,
    },
}

/// A paragraph's id and text (object characters included), for anchoring
/// comments and searching.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParagraphText {
    /// Block id.
    pub id: BlockId,
    /// Text.
    pub text: String,
}

/// Where an offset moves when a paragraph's text changes from `old` to
/// `new`: text kept at both ends keeps its place, an offset inside the
/// replaced middle goes to the end of the new middle.
fn map_offset(old: &str, new: &str, offset: usize) -> usize {
    let a: Vec<char> = old.chars().collect();
    let b: Vec<char> = new.chars().collect();
    let mut prefix = 0;
    while prefix < a.len() && prefix < b.len() && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < a.len() - prefix
        && suffix < b.len() - prefix
        && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let units = |cs: &[char]| cs.iter().map(|c| c.len_utf16()).sum::<usize>();
    let p16 = units(&a[..prefix]);
    let old_len = units(&a);
    let new_len = units(&b);
    let s16 = units(&a[a.len() - suffix..]);
    if offset <= p16 {
        offset
    } else if offset >= old_len - s16 {
        offset + new_len - old_len
    } else {
        new_len - s16
    }
}

/// Paragraphs in document order.
#[derive(Debug, Default)]
struct ParaOrder {
    list: Vec<BlockId>,
    index: HashMap<BlockId, usize>,
}

/// One undoable step.
#[derive(Clone, Debug)]
struct UndoEntry {
    step: Step,
    before: Selection,
    after: Selection,
    group: Option<String>,
}

/// A document open for editing.
pub struct Session {
    doc: Document,
    cache: LayoutCache,
    options: LayoutOptions,
    layout: Arc<Layout>,
    index: Arc<ViewIndex>,
    stale: bool,
    sel: Selection,
    /// Formatting for the next typed text at a caret (Ctrl+B with nothing selected).
    pending: Option<Attrs>,
    goal_x: Option<f32>,
    undo: Vec<UndoEntry>,
    redo: Vec<UndoEntry>,
    /// The last step may absorb the next one in this group (typing).
    open_group: Option<String>,
    /// Undo history is kept by the caller (collaborative editing).
    external_undo: bool,
    order: Option<(u64, Arc<ParaOrder>)>,
    /// Changed strips since the last result.
    bands: Vec<Band>,
    line_hashes: LineHashes,
    keys: PageKeys,
    fingerprints: Vec<u64>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("doc", &self.doc)
            .field("selection", &self.sel)
            .finish()
    }
}

/// A horizontal strip of a page that changed (points).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Band {
    /// Page index.
    pub page: usize,
    /// Top.
    pub top: f32,
    /// Bottom.
    pub bottom: f32,
}

/// Hashes of a paragraph's lines (glyphs, positions and run styles),
/// remembered per laid-out paragraph: cached paragraphs keep theirs between
/// layouts, so fingerprinting a page after an edit costs little.
#[derive(Default)]
struct LineHashes {
    map: HashMap<usize, (std::sync::Weak<ParaBox>, Arc<Vec<u64>>)>,
}

fn rgba_bits(c: &pptx_engine::model::color::Rgba) -> [u32; 4] {
    [c.r.to_bits(), c.g.to_bits(), c.b.to_bits(), c.a.to_bits()]
}

fn run_hash(r: &crate::layout::inline::RunStyle) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let p = &r.props;
    (r.size.to_bits(), r.shift.to_bits(), rgba_bits(&r.color)).hash(&mut h);
    (p.bold, p.italic, p.strike, p.dstrike, p.caps, p.small_caps).hash(&mut h);
    match &p.underline {
        Some(u) => {
            std::mem::discriminant(&u.style).hash(&mut h);
            u.color.as_ref().map(rgba_bits).hash(&mut h);
        }
        None => 0u8.hash(&mut h),
    }
    p.highlight.as_ref().map(rgba_bits).hash(&mut h);
    p.shading.as_ref().map(rgba_bits).hash(&mut h);
    r.revision.hash(&mut h);
    h.finish()
}

fn para_line_hashes(pb: &ParaBox) -> Vec<u64> {
    let runs: Vec<u64> = pb.inline.runs.iter().map(run_hash).collect();
    pb.lines
        .lines
        .iter()
        .map(|line| {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            (line.width.to_bits(), line.hyphen, line.height.to_bits()).hash(&mut h);
            for ci in line.start..line.end {
                let c = &pb.inline.clusters[ci];
                (c.ch, c.glyph, pb.lines.x[ci].to_bits()).hash(&mut h);
                if let Some(f) = &c.font {
                    f.face.hash(&mut h);
                }
                runs.get(c.run as usize).hash(&mut h);
            }
            h.finish()
        })
        .collect()
}

impl LineHashes {
    fn of(&mut self, pb: &Arc<ParaBox>) -> Arc<Vec<u64>> {
        let key = Arc::as_ptr(pb) as usize;
        if let Some((weak, hashes)) = self.map.get(&key)
            && weak.upgrade().is_some_and(|p| Arc::ptr_eq(&p, pb))
        {
            return Arc::clone(hashes);
        }
        let hashes = Arc::new(para_line_hashes(pb));
        self.map
            .insert(key, (Arc::downgrade(pb), Arc::clone(&hashes)));
        hashes
    }

    /// Forgets paragraphs no layout holds any more.
    fn prune(&mut self) {
        self.map.retain(|_, (weak, _)| weak.strong_count() > 0);
    }
}

/// A hash of one item and the vertical extent it paints.
fn item_key(item: &Item, lines: &mut LineHashes) -> (u64, f32, f32) {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let (top, bottom) = match item {
        Item::Line(l) => {
            0u8.hash(&mut h);
            (l.x.to_bits(), l.y.to_bits()).hash(&mut h);
            if let Some(c) = &l.clip {
                (c.x.to_bits(), c.y.to_bits(), c.w.to_bits(), c.h.to_bits()).hash(&mut h);
            }
            lines.of(&l.para).get(l.line).hash(&mut h);
            // Glyphs can reach a little past the line box.
            (l.y - 3.0, l.y + l.line().height + 3.0)
        }
        Item::Fill { rect, color } => {
            1u8.hash(&mut h);
            (rect.x.to_bits(), rect.y.to_bits(), rect.w.to_bits(), rect.h.to_bits()).hash(&mut h);
            rgba_bits(color).hash(&mut h);
            (rect.y - 1.0, rect.y + rect.h + 1.0)
        }
        Item::Rule {
            x0,
            y0,
            x1,
            y1,
            border,
        } => {
            2u8.hash(&mut h);
            (x0.to_bits(), y0.to_bits(), x1.to_bits(), y1.to_bits()).hash(&mut h);
            (
                std::mem::discriminant(&border.style),
                border.width.to_bits(),
                border.space.to_bits(),
            )
                .hash(&mut h);
            format!("{:?}", border.color).hash(&mut h);
            let pad = border.width * 3.0 + 2.0;
            (y0.min(*y1) - pad, y0.max(*y1) + pad)
        }
        Item::Drawing(d) => {
            3u8.hash(&mut h);
            (Arc::as_ptr(&d.drawing) as usize).hash(&mut h);
            (d.rect.x.to_bits(), d.rect.y.to_bits(), d.rect.w.to_bits(), d.rect.h.to_bits())
                .hash(&mut h);
            // Rotated or effect-extended drawings can reach further.
            let pad = d.rect.w.max(d.rect.h) * 0.5;
            (d.rect.y - pad, d.rect.y + d.rect.h + pad)
        }
        Item::LineNumber {
            text,
            right,
            baseline,
            size,
            ..
        } => {
            4u8.hash(&mut h);
            text.hash(&mut h);
            (right.to_bits(), baseline.to_bits()).hash(&mut h);
            (baseline - size * 1.2, baseline + size * 0.5)
        }
    };
    (h.finish(), top, bottom)
}

/// Item keys of every page.
type PageKeys = Vec<Vec<(u64, f32, f32)>>;

fn page_keys(layout: &Layout, lines: &mut LineHashes) -> PageKeys {
    layout
        .pages
        .iter()
        .map(|p| p.all_items().map(|i| item_key(i, lines)).collect())
        .collect()
}

/// A page's fingerprint from its item keys.
fn fingerprint(page: &Page, keys: &[(u64, f32, f32)]) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (page.width.to_bits(), page.height.to_bits(), page.number).hash(&mut h);
    for k in keys {
        k.0.hash(&mut h);
    }
    h.finish()
}

/// Strips of each page that differ between two layouts; a page whose size
/// changed (or that is new) is dirty from top to bottom.
fn dirty_bands(old: &Layout, old_keys: &PageKeys, new: &Layout, new_keys: &PageKeys) -> Vec<Band> {
    let mut out = Vec::new();
    for (i, page) in new.pages.iter().enumerate() {
        let (Some(before), Some(a)) = (old.pages.get(i), old_keys.get(i)) else {
            out.push(Band {
                page: i,
                top: 0.0,
                bottom: page.height,
            });
            continue;
        };
        if before.width != page.width || before.height != page.height || before.number != page.number {
            out.push(Band {
                page: i,
                top: 0.0,
                bottom: page.height,
            });
            continue;
        }
        let b = &new_keys[i];
        let mut count: HashMap<u64, i64> = HashMap::new();
        for k in a {
            *count.entry(k.0).or_default() += 1;
        }
        for k in b {
            *count.entry(k.0).or_default() -= 1;
        }
        // Items rarely swap paint order without moving; compare as multisets.
        let mut spans: Vec<(f32, f32)> = a
            .iter()
            .chain(b)
            .filter(|k| count.get(&k.0).is_some_and(|c| *c != 0))
            .map(|k| (k.1.max(0.0), k.2.min(page.height)))
            .collect();
        spans.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut merged: Vec<(f32, f32)> = Vec::new();
        for (t, bt) in spans {
            match merged.last_mut() {
                Some(last) if t <= last.1 + 2.0 => last.1 = last.1.max(bt),
                _ => merged.push((t, bt)),
            }
        }
        for (top, bottom) in merged {
            if bottom > top {
                out.push(Band {
                    page: i,
                    top,
                    bottom,
                });
            }
        }
    }
    out
}

/// Kinds of characters for word movement.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CharClass {
    Space,
    Word,
    Punct,
}

fn class(c: char) -> CharClass {
    if c.is_whitespace() || c == OBJECT_CHAR {
        CharClass::Space
    } else if c.is_alphanumeric() || c == '_' || c == '\'' || c == '\u{2019}' {
        CharClass::Word
    } else {
        CharClass::Punct
    }
}

/// UTF-16 offsets of each char of `text` (plus the end).
fn char_offsets(text: &str) -> Vec<usize> {
    let mut out = Vec::with_capacity(text.len() + 1);
    let mut at = 0;
    for c in text.chars() {
        out.push(at);
        at += c.len_utf16();
    }
    out.push(at);
    out
}

/// The next word boundary after `offset` (Ctrl+Right: past the word, then
/// past the spaces after it).
fn word_forward(text: &str, offset: usize) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let offs = char_offsets(text);
    let mut i = offs
        .iter()
        .position(|&o| o >= offset)
        .unwrap_or(chars.len());
    if i < chars.len() {
        let k = class(chars[i]);
        if k != CharClass::Space {
            while i < chars.len() && class(chars[i]) == k {
                i += 1;
            }
        }
        while i < chars.len() && class(chars[i]) == CharClass::Space {
            i += 1;
        }
    }
    offs[i.min(chars.len())]
}

/// The previous word boundary before `offset` (Ctrl+Left).
fn word_backward(text: &str, offset: usize) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let offs = char_offsets(text);
    let mut i = offs
        .iter()
        .position(|&o| o >= offset)
        .unwrap_or(chars.len());
    while i > 0 && class(chars[i - 1]) == CharClass::Space {
        i -= 1;
    }
    if i > 0 {
        let k = class(chars[i - 1]);
        while i > 0 && class(chars[i - 1]) == k {
            i -= 1;
        }
    }
    offs[i]
}

/// The word around `offset`.
fn word_at(text: &str, offset: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();
    let offs = char_offsets(text);
    if chars.is_empty() {
        return (0, 0);
    }
    let mut i = offs
        .iter()
        .position(|&o| o >= offset)
        .unwrap_or(chars.len())
        .min(chars.len() - 1);
    // At the end of a word, select that word.
    if i > 0 && class(chars[i]) == CharClass::Space && class(chars[i - 1]) != CharClass::Space {
        i -= 1;
    }
    let k = class(chars[i]);
    let mut s = i;
    while s > 0 && class(chars[s - 1]) == k {
        s -= 1;
    }
    let mut e = i + 1;
    while e < chars.len() && class(chars[e]) == k {
        e += 1;
    }
    (offs[s], offs[e])
}

impl Session {
    /// Opens a session over a document; the caret starts at the beginning.
    pub fn new(doc: Document) -> Self {
        let first = doc.body().paragraphs().into_iter().next();
        let mut s = Self {
            doc,
            cache: LayoutCache::new(),
            options: LayoutOptions::default(),
            layout: Arc::new(Layout::default()),
            index: Arc::new(ViewIndex::default()),
            stale: true,
            sel: Selection::caret(Pos::new(BlockId::new(""), 0)),
            pending: None,
            goal_x: None,
            undo: Vec::new(),
            redo: Vec::new(),
            open_group: None,
            external_undo: false,
            order: None,
            bands: Vec::new(),
            line_hashes: LineHashes::default(),
            keys: Vec::new(),
            fingerprints: Vec::new(),
        };
        let first = first.unwrap_or_else(|| s.ensure_paragraph());
        s.sel = Selection::caret(Pos::new(first, 0));
        s
    }

    /// An empty body gets one paragraph so there is somewhere to type.
    fn ensure_paragraph(&mut self) -> BlockId {
        let id = self.doc.next_block_id();
        let order = self.doc.body.key_after(None, None);
        self.doc.body.insert(crate::model::block::Block::new(
            id.clone(),
            BlockKind::Paragraph,
            None,
            order,
        ));
        id
    }

    /// The document.
    pub fn document(&self) -> &Document {
        &self.doc
    }

    /// The document, for changes made outside edit operations (the caller
    /// must keep the selection valid; the layout is recomputed).
    pub fn document_mut(&mut self) -> &mut Document {
        self.stale = true;
        self.order = None;
        &mut self.doc
    }

    /// Leaves undo history to the caller (collaborative editing keeps it
    /// in the shared document instead).
    pub fn set_external_undo(&mut self, external: bool) {
        self.external_undo = external;
        self.undo.clear();
        self.redo.clear();
    }

    /// Shows tracked changes inline (`true`) or the document as if they
    /// were accepted.
    pub fn set_markup(&mut self, markup: bool) {
        if self.options.markup != markup {
            self.options.markup = markup;
            self.stale = true;
        }
    }

    /// Layout choices.
    pub fn set_options(&mut self, options: LayoutOptions) {
        self.options = options;
        self.stale = true;
    }

    /// The selection.
    pub fn selection(&self) -> &Selection {
        &self.sel
    }

    /// The current layout (recomputed if the document changed).
    pub fn layout(&mut self, fonts: &FontDb) -> Arc<Layout> {
        self.ensure_layout(fonts);
        Arc::clone(&self.layout)
    }

    /// Pages with their fingerprints.
    pub fn pages(&mut self, fonts: &FontDb) -> Vec<PageInfo> {
        self.ensure_layout(fonts);
        self.page_infos()
    }

    fn page_infos(&self) -> Vec<PageInfo> {
        self.layout
            .pages
            .iter()
            .zip(&self.fingerprints)
            .map(|(p, f)| PageInfo {
                width: p.width,
                height: p.height,
                fingerprint: format!("{f:016x}"),
            })
            .collect()
    }

    fn ensure_layout(&mut self, fonts: &FontDb) -> bool {
        if !self.stale {
            return false;
        }
        let layout = self.doc.layout_cached(fonts, &self.options, &self.cache);
        self.index = Arc::new(ViewIndex::build(&layout));
        let keys = page_keys(&layout, &mut self.line_hashes);
        let bands = dirty_bands(&self.layout, &self.keys, &layout, &keys);
        self.bands.extend(bands);
        self.fingerprints = layout
            .pages
            .iter()
            .zip(&keys)
            .map(|(p, k)| fingerprint(p, k))
            .collect();
        self.keys = keys;
        self.layout = Arc::new(layout);
        // The old layout is gone: forget its paragraphs' hashes.
        self.line_hashes.prune();
        self.stale = false;
        true
    }

    fn order(&mut self) -> Arc<ParaOrder> {
        let rev = self.doc.body.revision();
        if let Some((r, o)) = &self.order
            && *r == rev
        {
            return Arc::clone(o);
        }
        let list = self.doc.body.paragraphs();
        let index = list
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i))
            .collect();
        let o = Arc::new(ParaOrder { list, index });
        self.order = Some((rev, Arc::clone(&o)));
        o
    }

    /// The selection's ends in document order.
    fn ordered(&mut self) -> (Pos, Pos) {
        let o = self.order();
        let a = &self.sel.anchor;
        let f = &self.sel.focus;
        let ia = o.index.get(&a.block).copied().unwrap_or(0);
        let ifo = o.index.get(&f.block).copied().unwrap_or(0);
        if (ia, a.offset) <= (ifo, f.offset) {
            (a.clone(), f.clone())
        } else {
            (f.clone(), a.clone())
        }
    }

    /// Paragraphs from `a` to `b` inclusive, in document order.
    fn paras_between(&mut self, a: &BlockId, b: &BlockId) -> Vec<BlockId> {
        let o = self.order();
        let (Some(&i), Some(&j)) = (o.index.get(a), o.index.get(b)) else {
            return vec![a.clone()];
        };
        let (i, j) = if i <= j { (i, j) } else { (j, i) };
        o.list[i..=j].to_vec()
    }

    fn para_len(&self, id: &BlockId) -> usize {
        self.doc.body.get(id).map_or(0, |b| b.content.len())
    }

    /// Keeps the selection on existing paragraphs and in range.
    fn clamp_selection(&mut self) {
        let fix = |s: &mut Self, p: Pos| -> Pos {
            match s.doc.body.get(&p.block) {
                Some(b) if b.kind == BlockKind::Paragraph => {
                    let len = b.content.len();
                    Pos {
                        offset: p.offset.min(len),
                        ..p
                    }
                }
                _ => {
                    let first = s.doc.body.paragraphs().into_iter().next();
                    let id = first.unwrap_or_else(|| s.ensure_paragraph());
                    Pos::new(id, 0)
                }
            }
        };
        let a = fix(self, self.sel.anchor.clone());
        let f = fix(self, self.sel.focus.clone());
        self.sel = Selection {
            anchor: a,
            focus: f,
        };
    }

    /// The shared parts and namespace declarations, detached from the
    /// document so formatting can be resolved while it is being changed.
    fn style_env(&self) -> (crate::document::Parts, Arc<Vec<crate::xml::Decl>>) {
        (self.doc.parts().clone(), Arc::clone(self.doc.decls()))
    }

    /// A paragraph's format as laid out (falls back to resolving it).
    fn para_format(&self, formats: &Formats<'_>, id: &BlockId) -> Option<Arc<ParaFormat>> {
        if let Some(entries) = self.index.lines.get(id)
            && let Some(&(p, i)) = entries.first()
            && let Some(Item::Line(l)) = self.layout.pages.get(p).and_then(|pg| pg.items.get(i))
        {
            return Some(Arc::clone(&l.para.format));
        }
        let b = self.doc.body.get(id)?;
        Some(formats.paragraph(&b.props, &TableCtx::default()))
    }

    fn snippets(&self) -> SnippetContext {
        SnippetContext::new(self.doc.decls())
    }

    fn typing_attrs_at(&self, pos: &Pos) -> Attrs {
        if let Some(p) = &self.pending {
            return p.clone();
        }
        let Some(b) = self.doc.body.get(&pos.block) else {
            return Attrs::empty();
        };
        text::typing_attrs(b, pos.offset, self.doc.w_prefix(), &self.snippets())
    }

    // ----- results -------------------------------------------------------

    fn format_state(&mut self) -> FormatState {
        let (start, end) = self.ordered();
        let paras = self.paras_between(&start.block, &end.block);
        let (parts, decls) = self.style_env();
        let formats = Formats::new(
            &parts.styles,
            &parts.numbering,
            &parts.settings,
            &parts.theme,
            &decls,
        );
        let Some(para) = self.para_format(&formats, &start.block) else {
            return FormatState::default();
        };
        let attrs = if self.sel.is_collapsed() {
            self.typing_attrs_at(&start)
        } else {
            self.doc
                .body
                .get(&start.block)
                .and_then(|b| {
                    // The first character of the selection.
                    let at = if start.offset < b.content.len() {
                        start.offset
                    } else {
                        start.offset.saturating_sub(1)
                    };
                    b.content.attrs_at(at).cloned()
                })
                .unwrap_or_default()
        };
        let props = formats.run(&attrs, &para);
        let mut state = FormatState {
            bold: props.bold,
            italic: props.italic,
            underline: props.underline.is_some(),
            strike: props.strike,
            superscript: props.vert_align == crate::model::props::VertAlign::Super,
            subscript: props.vert_align == crate::model::props::VertAlign::Sub,
            font: Some(props.ascii.clone()),
            size: Some(props.size),
            color: props
                .color
                .map(|c| c.to_hex().trim_start_matches('#').to_uppercase()),
            ..FormatState::default()
        };
        // Toggles show as on only when the whole selection has them.
        if !self.sel.is_collapsed() {
            let mut checked = 0usize;
            'outer: for (k, id) in paras.iter().enumerate() {
                let Some(b) = self.doc.body.get(id) else {
                    continue;
                };
                let Some(pf) = self.para_format(&formats, id) else {
                    continue;
                };
                let s = if k == 0 { start.offset } else { 0 };
                let e = if k + 1 == paras.len() {
                    end.offset
                } else {
                    usize::MAX
                };
                for (at, span) in b.content.spans_at() {
                    let len = utf16_len(&span.text);
                    if at + len <= s || at >= e || span.attrs.is_object() {
                        continue;
                    }
                    let p = formats.run(&span.attrs, &pf);
                    state.bold &= p.bold;
                    state.italic &= p.italic;
                    state.underline &= p.underline.is_some();
                    state.strike &= p.strike;
                    checked += 1;
                    if checked > 500 {
                        break 'outer;
                    }
                }
            }
        }
        let styles = &self.doc.parts().styles;
        let style_id = para
            .props
            .style
            .clone()
            .or_else(|| styles.default_paragraph_id().map(str::to_owned));
        state.style_name = style_id
            .as_deref()
            .and_then(|id| styles.get(id))
            .map(|s| s.name.clone());
        state.style = style_id;
        state.align = Some(match para.props.jc {
            Align::Center => Alignment::Center,
            Align::Right => Alignment::Right,
            Align::Justify | Align::Distribute => Alignment::Justify,
            Align::Left => Alignment::Left,
        });
        state.list = para.props.num.is_some();
        state.can_undo = !self.undo.is_empty();
        state.can_redo = !self.redo.is_empty();
        state
    }

    fn result(&mut self, changes: Vec<Change>, relaid: bool) -> EditResult {
        let (start, end) = self.ordered();
        let paras = self.paras_between(&start.block, &end.block);
        let caret = geometry::caret(&self.layout, &self.index, &self.sel.focus);
        let rects =
            geometry::selection_rects(&self.layout, &self.index, &self.sel, (&start, &end), &paras);
        let format = self.format_state();
        EditResult {
            changed: !changes.is_empty(),
            changes,
            selection: self.sel.clone(),
            range: Range {
                from: start.clone(),
                to: end.clone(),
            },
            caret,
            rects,
            pages: relaid.then(|| self.page_infos()),
            bands: std::mem::take(&mut self.bands),
            format,
        }
    }

    /// The selection's current state without changing anything.
    pub fn state(&mut self, fonts: &FontDb) -> EditResult {
        let relaid = self.ensure_layout(fonts);
        self.clamp_selection();
        self.result(Vec::new(), relaid)
    }

    /// Opens a session over a shared document; undo history stays with
    /// the caller.
    pub fn from_collab(state: &crate::collab::CollabState, seed: u64) -> crate::Result<Self> {
        let doc = Document::from_collab_state(state, seed)?;
        let mut s = Self::new(doc);
        s.external_undo = true;
        Ok(s)
    }

    /// The shared state of the document.
    pub fn collab_state(&self) -> crate::Result<crate::collab::CollabState> {
        self.doc.collab_state()
    }

    /// The selected text, paragraphs separated by newlines (objects such
    /// as pictures and field markers left out), for the clipboard.
    pub fn selected_text(&mut self) -> String {
        let (s, e) = self.ordered();
        if s.same_place(&e) {
            return String::new();
        }
        let paras = self.paras_between(&s.block, &e.block);
        let mut out = String::new();
        for (k, id) in paras.iter().enumerate() {
            let Some(b) = self.doc.body.get(id) else {
                continue;
            };
            if k > 0 {
                out.push('\n');
            }
            let from = if k == 0 { s.offset } else { 0 };
            let to = if k + 1 == paras.len() {
                e.offset
            } else {
                b.content.len()
            };
            for (at, span) in b.content.spans_at() {
                let len = utf16_len(&span.text);
                if at + len <= from || at >= to || span.attrs.is_object() || span.attrs.is_instr() {
                    continue;
                }
                let lo = from.saturating_sub(at);
                let hi = (to - at).min(len);
                let text = &span.text;
                let a = crate::model::content::byte_at(text, lo);
                let b = crate::model::content::byte_at(text, hi);
                out.push_str(&text[a..b]);
            }
        }
        out
    }

    /// Paragraph ids and texts in document order.
    pub fn paragraphs(&self) -> Vec<ParagraphText> {
        self.doc
            .body
            .paragraphs()
            .into_iter()
            .filter_map(|id| {
                let text = self.doc.body.get(&id)?.content.text();
                Some(ParagraphText { id, text })
            })
            .collect()
    }

    /// Applies changes other peers made (or the shared undo history
    /// replayed), keeping the selection on the same text.
    pub fn apply_remote(
        &mut self,
        changes: &[RemoteChange],
        fonts: &FontDb,
    ) -> crate::Result<EditResult> {
        let mut entries: Vec<(String, String, Option<String>)> = Vec::new();
        let mut old_texts: HashMap<BlockId, String> = HashMap::new();
        for c in changes {
            match c {
                RemoteChange::Block { block } => {
                    let Some(b) = block.to_block() else {
                        continue;
                    };
                    if let Some(old) = self.doc.body.get(&b.id) {
                        old_texts
                            .entry(b.id.clone())
                            .or_insert_with(|| old.content.text());
                    }
                    self.doc.body.insert(b);
                    self.doc.body_dirty = true;
                }
                RemoteChange::Remove { id } => {
                    if self.doc.body.contains(id) {
                        self.doc.body.remove_one(id);
                        self.doc.body_dirty = true;
                    }
                }
                RemoteChange::Entry {
                    container,
                    key,
                    value,
                } => entries.push((container.clone(), key.clone(), value.clone())),
            }
        }
        if !entries.is_empty() {
            self.doc.apply_entries(&entries)?;
        }
        // Keep the caret on the same text.
        for pos in [&mut self.sel.anchor, &mut self.sel.focus] {
            if let Some(old) = old_texts.get(&pos.block)
                && let Some(b) = self.doc.body.get(&pos.block)
            {
                let new = b.content.text();
                pos.offset = map_offset(old, &new, pos.offset);
            }
        }
        self.stale = true;
        self.order = None;
        self.pending = None;
        let relaid = self.ensure_layout(fonts);
        self.clamp_selection();
        Ok(self.result(Vec::new(), relaid))
    }

    // ----- geometry ------------------------------------------------------

    /// The position at a point on a page (points).
    pub fn hit_test(&mut self, page: usize, x: f32, y: f32, fonts: &FontDb) -> Option<Pos> {
        self.ensure_layout(fonts);
        geometry::hit_test(&self.layout, &self.index, page, x, y)
    }

    /// The caret for a position.
    pub fn caret_at(&mut self, pos: &Pos, fonts: &FontDb) -> Option<CaretRect> {
        self.ensure_layout(fonts);
        geometry::caret(&self.layout, &self.index, pos)
    }

    /// Highlight rectangles of a range in one paragraph or across several
    /// (comments, search results, other people's selections).
    pub fn range_rects(&mut self, a: &Pos, b: &Pos, fonts: &FontDb) -> Vec<PageRect> {
        self.ensure_layout(fonts);
        let o = self.order();
        let ia = o.index.get(&a.block).copied().unwrap_or(0);
        let ib = o.index.get(&b.block).copied().unwrap_or(0);
        let (s, e) = if (ia, a.offset) <= (ib, b.offset) {
            (a, b)
        } else {
            (b, a)
        };
        let paras = self.paras_between(&s.block, &e.block);
        geometry::range_rects(&self.layout, &self.index, s, e, &paras)
    }

    // ----- operations ----------------------------------------------------

    /// Applies operations in order as one undo step (merged into the
    /// previous step when both carry the same `group`, as typing does).
    pub fn apply(
        &mut self,
        ops: &[EditOp],
        group: Option<&str>,
        fonts: &FontDb,
    ) -> crate::Result<EditResult> {
        let mut relaid = self.ensure_layout(fonts);
        self.clamp_selection();
        let before = self.sel.clone();
        let snapshot = self.doc.snapshot();
        let mut step = Step::default();
        for op in ops {
            if self.stale {
                relaid |= self.ensure_layout(fonts);
            }
            if let Some(s) = self.run_op(op)? {
                step.merge(s);
                self.stale = true;
            }
        }
        relaid |= self.ensure_layout(fonts);
        self.clamp_selection();
        let mut changes = step.changes();
        changes.extend(self.doc.entry_changes(&snapshot)?);
        if !step.is_empty() {
            self.record_undo(step, before, group);
        } else if ops.iter().any(|op| {
            matches!(
                op,
                EditOp::Select { .. } | EditOp::Move { .. } | EditOp::SelectAll
            )
        }) {
            self.open_group = None;
        }
        Ok(self.result(changes, relaid))
    }

    fn record_undo(&mut self, step: Step, before: Selection, group: Option<&str>) {
        if self.external_undo {
            return;
        }
        self.redo.clear();
        let after = self.sel.clone();
        if let (Some(g), Some(last)) = (group, self.undo.last_mut())
            && self.open_group.as_deref() == Some(g)
            && last.group.as_deref() == Some(g)
        {
            last.step.merge(step);
            last.after = after;
            return;
        }
        self.undo.push(UndoEntry {
            step,
            before,
            after,
            group: group.map(str::to_owned),
        });
        self.open_group = group.map(str::to_owned);
        if self.undo.len() > 500 {
            self.undo.remove(0);
        }
    }

    /// Ends the current typing group.
    pub fn break_group(&mut self) {
        self.open_group = None;
    }

    /// Undoes the last step.
    pub fn undo(&mut self, fonts: &FontDb) -> Option<EditResult> {
        let entry = self.undo.pop()?;
        let inverse = entry.step.inverse();
        txn::apply_step(&mut self.doc, &inverse);
        self.stale = true;
        self.order = None;
        self.sel = entry.before.clone();
        self.pending = None;
        self.open_group = None;
        let changes = inverse.changes();
        self.redo.push(entry);
        let relaid = self.ensure_layout(fonts);
        self.clamp_selection();
        Some(self.result(changes, relaid))
    }

    /// Redoes the last undone step.
    pub fn redo(&mut self, fonts: &FontDb) -> Option<EditResult> {
        let entry = self.redo.pop()?;
        txn::apply_step(&mut self.doc, &entry.step);
        self.stale = true;
        self.order = None;
        self.sel = entry.after.clone();
        self.pending = None;
        self.open_group = None;
        let changes = entry.step.changes();
        self.undo.push(entry);
        let relaid = self.ensure_layout(fonts);
        self.clamp_selection();
        Some(self.result(changes, relaid))
    }

    /// Whether undo is possible.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether redo is possible.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Serializes the document.
    pub fn save(&self) -> crate::Result<Vec<u8>> {
        self.doc.save()
    }

    fn set_caret(&mut self, pos: Pos) {
        self.sel = Selection::caret(pos);
    }

    /// Runs one operation; returns the transaction step when it changed
    /// the document.
    fn run_op(&mut self, op: &EditOp) -> crate::Result<Option<Step>> {
        if !matches!(
            op,
            EditOp::Move {
                unit: Unit::Line,
                ..
            }
        ) {
            self.goal_x = None;
        }
        match op {
            EditOp::Select { anchor, focus } => {
                self.sel = Selection {
                    anchor: anchor.clone(),
                    focus: focus.clone(),
                };
                self.clamp_selection();
                self.pending = None;
                Ok(None)
            }
            EditOp::SelectAll => {
                let o = self.order();
                if let (Some(first), Some(last)) = (o.list.first(), o.list.last()) {
                    let len = self.para_len(last);
                    self.sel = Selection {
                        anchor: Pos::new(first.clone(), 0),
                        focus: Pos::new(last.clone(), len),
                    };
                }
                self.pending = None;
                Ok(None)
            }
            EditOp::SelectWord { at } => {
                let text = self
                    .doc
                    .body
                    .get(&at.block)
                    .map(|b| b.content.text())
                    .unwrap_or_default();
                let (s, e) = word_at(&text, at.offset);
                self.sel = Selection {
                    anchor: Pos::new(at.block.clone(), s),
                    focus: Pos::new(at.block.clone(), e),
                };
                self.pending = None;
                Ok(None)
            }
            EditOp::SelectParagraph { at } => {
                let len = self.para_len(&at.block);
                self.sel = Selection {
                    anchor: Pos::new(at.block.clone(), 0),
                    focus: Pos::new(at.block.clone(), len),
                };
                self.pending = None;
                Ok(None)
            }
            EditOp::Move {
                unit,
                forward,
                extend,
            } => {
                self.move_caret(*unit, *forward, *extend);
                self.pending = None;
                Ok(None)
            }
            EditOp::InsertText { text } => Ok(Some(self.insert_text(text))),
            EditOp::InsertParagraph => Ok(Some(self.insert_paragraph())),
            EditOp::InsertBreak { kind } => Ok(Some(self.insert_break(*kind))),
            EditOp::Delete { forward, unit } => Ok(self.delete(*forward, *unit)),
            EditOp::ToggleFormat { format } => Ok(self.toggle(*format)),
            EditOp::SetFormat { patch } => {
                let w = self.doc.w_prefix().to_owned();
                let patch = patch.clone();
                Ok(self.map_runs(move |a| patch.apply(a, &w)))
            }
            EditOp::ClearFormat => Ok(self.map_runs(format::cleared)),
            EditOp::SetParagraph { patch } => {
                let decls = Arc::clone(self.doc.decls());
                let patch = patch.clone();
                Ok(self.map_paragraphs(move |e| patch.apply(e, &decls)))
            }
            EditOp::SetStyle { style } => {
                if self.doc.parts().styles.get(style).is_none() {
                    return Err(crate::Error::InvalidEdit(format!("no style `{style}`")));
                }
                let style = style.clone();
                Ok(self.map_paragraphs(move |e| e.set_val("pStyle", Some(&style))))
            }
            EditOp::ToggleList { kind } => self.toggle_list(*kind),
            EditOp::Indent { forward } => Ok(self.indent(*forward)),
            EditOp::InsertTable { rows, cols } => Ok(self.insert_table(*rows, *cols)),
            EditOp::InsertRow { below } => {
                let below = *below;
                Ok(self.table_op(move |txn, p| table::insert_row(txn, p, below)))
            }
            EditOp::InsertColumn { right } => {
                let right = *right;
                Ok(self.table_op(move |txn, p| table::insert_column(txn, p, right)))
            }
            EditOp::DeleteRow => Ok(self.table_op(table::delete_row)),
            EditOp::DeleteColumn => Ok(self.table_op(table::delete_column)),
            EditOp::DeleteTable => Ok(self.table_op(table::delete_table)),
        }
    }

    // ----- lists and tables ----------------------------------------------

    /// The list kind each paragraph has (from its formatting).
    fn list_kinds(&self, paras: &[BlockId]) -> Vec<Option<(ListKind, i64, u8)>> {
        let (parts, decls) = self.style_env();
        let formats = Formats::new(
            &parts.styles,
            &parts.numbering,
            &parts.settings,
            &parts.theme,
            &decls,
        );
        paras
            .iter()
            .map(|id| {
                let pf = self.para_format(&formats, id)?;
                let (num, ilvl) = pf.props.num?;
                if num <= 0 {
                    return None;
                }
                let level = parts.numbering.level(num, ilvl, &parts.styles)?;
                Some((lists::kind_of(&level.fmt)?, num, ilvl))
            })
            .collect()
    }

    fn toggle_list(&mut self, kind: ListKind) -> crate::Result<Option<Step>> {
        let (s, e) = self.ordered();
        let paras = self.paras_between(&s.block, &e.block);
        let kinds = self.list_kinds(&paras);
        let all = kinds.iter().all(|k| k.is_some_and(|(k, _, _)| k == kind));
        let w = self.doc.w_prefix().to_owned();
        let q = |l: &str| {
            if w.is_empty() {
                l.to_owned()
            } else {
                format!("{w}:{l}")
            }
        };
        let list_style = self
            .doc
            .parts()
            .styles
            .id_by_name("List Paragraph")
            .map(str::to_owned);
        let default_style = self
            .doc
            .parts()
            .styles
            .default_paragraph_id()
            .map(str::to_owned);
        if all {
            // Back to plain paragraphs.
            let styles = std::sync::Arc::clone(&self.doc.parts().styles);
            let mut txn = Txn::new(&mut self.doc);
            for id in &paras {
                format::edit_ppr(&mut txn, id, |e| {
                    let style = e.get("pStyle").map(str::to_owned);
                    let style_id = style.as_deref().and_then(|x| {
                        let at = x.find("val=\"")? + 5;
                        x[at..].split('"').next().map(str::to_owned)
                    });
                    let style_numbered = style_id
                        .as_deref()
                        .and_then(|id| styles.get(id))
                        .is_some_and(|st| st.ppr.num.num_id.is_some_and(|n| n > 0));
                    if style_numbered {
                        e.set(
                            "numPr",
                            Some(format!(
                                "<{np}><{nid} {val}=\"0\"/></{np}>",
                                np = q("numPr"),
                                nid = q("numId"),
                                val = q("val")
                            )),
                        );
                    } else {
                        e.set("numPr", None);
                    }
                    if style_id.is_some() && style_id == list_style {
                        e.set("pStyle", None);
                    }
                });
            }
            return Ok(Some(txn.finish()));
        }
        // Continue the list just before the selection, if it is this kind.
        let prev = self.neighbour_para(&paras[0], false);
        let continued = prev
            .map(|p| self.list_kinds(&[p]))
            .and_then(|k| k.into_iter().next().flatten())
            .filter(|(k, _, _)| *k == kind);
        let (num, base_level) = match continued {
            Some((_, num, ilvl)) => (num, ilvl),
            None => (lists::instance_for(&mut self.doc, kind)?, 0),
        };
        self.stale = true;
        let current = self.list_kinds(&paras);
        let mut txn = Txn::new(&mut self.doc);
        for (id, k) in paras.iter().zip(current) {
            let ilvl = k.map_or(base_level, |(_, _, l)| l);
            format::edit_ppr(&mut txn, id, |e| {
                e.set(
                    "numPr",
                    Some(format!(
                        "<{np}><{il} {val}=\"{ilvl}\"/><{nid} {val}=\"{num}\"/></{np}>",
                        np = q("numPr"),
                        il = q("ilvl"),
                        nid = q("numId"),
                        val = q("val")
                    )),
                );
                // Word gives new list items the List Paragraph style.
                let plain = e.get("pStyle").is_none_or(|x| {
                    default_style
                        .as_deref()
                        .is_some_and(|d| x.contains(&format!("\"{d}\"")))
                });
                if plain && let Some(ls) = &list_style {
                    e.set_val("pStyle", Some(ls));
                }
            });
        }
        Ok(Some(txn.finish()))
    }

    fn indent(&mut self, forward: bool) -> Option<Step> {
        let (s, e) = self.ordered();
        let paras = self.paras_between(&s.block, &e.block);
        let kinds = self.list_kinds(&paras);
        let w = self.doc.w_prefix().to_owned();
        let decls = std::sync::Arc::clone(self.doc.decls());
        let q = |l: &str| {
            if w.is_empty() {
                l.to_owned()
            } else {
                format!("{w}:{l}")
            }
        };
        let (parts, pdecls) = self.style_env();
        let formats = Formats::new(
            &parts.styles,
            &parts.numbering,
            &parts.settings,
            &parts.theme,
            &pdecls,
        );
        let lefts: Vec<f32> = paras
            .iter()
            .map(|id| {
                self.para_format(&formats, id)
                    .map_or(0.0, |pf| pf.props.ind_left)
            })
            .collect();
        let mut txn = Txn::new(&mut self.doc);
        for ((id, k), left) in paras.iter().zip(kinds).zip(lefts) {
            match k {
                Some((_, num, ilvl)) => {
                    let next = if forward {
                        (ilvl + 1).min(8)
                    } else {
                        ilvl.saturating_sub(1)
                    };
                    format::edit_ppr(&mut txn, id, |e| {
                        e.set(
                            "numPr",
                            Some(format!(
                                "<{np}><{il} {val}=\"{next}\"/><{nid} {val}=\"{num}\"/></{np}>",
                                np = q("numPr"),
                                il = q("ilvl"),
                                nid = q("numId"),
                                val = q("val")
                            )),
                        );
                    });
                }
                None => {
                    // Half an inch at a time, to the next multiple.
                    let step = 36.0;
                    let target = if forward {
                        ((left / step).floor() + 1.0) * step
                    } else {
                        (((left / step).ceil() - 1.0) * step).max(0.0)
                    };
                    let twips = ((target * 20.0).round() as i64).to_string();
                    format::edit_ppr(&mut txn, id, |e| {
                        e.set_attrs(
                            "ind",
                            &[("left", Some(twips.clone())), ("start", None)],
                            &decls,
                        );
                    });
                }
            }
        }
        Some(txn.finish())
    }

    fn insert_table(&mut self, rows: usize, cols: usize) -> Option<Step> {
        let at = self.sel.focus.clone();
        let width = {
            let section = self.doc.final_section();
            ((section.text_width() * 20.0).round() as i64).max(1440)
        };
        let grid_style = self
            .doc
            .parts()
            .styles
            .id_by_name("Table Grid")
            .map(str::to_owned);
        let sel = self.sel.clone();
        let mut txn = Txn::new(&mut self.doc);
        let at = if sel.is_collapsed() {
            at
        } else {
            delete_selection(&mut txn, &sel)
        };
        // Nested tables get two thirds of the page width.
        let nested = table::enclosing(&txn, &at.block).is_some();
        let width = if nested { width * 2 / 3 } else { width };
        let caret = table::insert_table(&mut txn, &at, rows, cols, width, grid_style.as_deref());
        let step = txn.finish();
        if let Some(c) = caret {
            self.set_caret(c);
        }
        Some(step)
    }

    fn table_op(&mut self, f: impl FnOnce(&mut Txn<'_>, &BlockId) -> Option<Pos>) -> Option<Step> {
        let at = self.sel.focus.block.clone();
        let mut txn = Txn::new(&mut self.doc);
        let caret = f(&mut txn, &at);
        let step = txn.finish();
        if let Some(c) = caret {
            self.set_caret(c);
        }
        Some(step)
    }

    // ----- movement ------------------------------------------------------

    fn stops(&self, block: &BlockId) -> Vec<usize> {
        geometry::para_stops(&self.layout, &self.index, block).unwrap_or_else(|| {
            let len = self.para_len(block);
            let text = self
                .doc
                .body
                .get(block)
                .map(|b| b.content.text())
                .unwrap_or_default();
            let mut offs = char_offsets(&text);
            offs.retain(|&o| o <= len);
            offs
        })
    }

    fn neighbour_para(&mut self, id: &BlockId, forward: bool) -> Option<BlockId> {
        let o = self.order();
        let i = *o.index.get(id)?;
        if forward {
            o.list.get(i + 1).cloned()
        } else {
            i.checked_sub(1).and_then(|j| o.list.get(j).cloned())
        }
    }

    fn step_char(&mut self, from: &Pos, forward: bool) -> Pos {
        let stops = self.stops(&from.block);
        if forward {
            if let Some(&n) = stops.iter().find(|&&s| s > from.offset) {
                return Pos::new(from.block.clone(), n);
            }
            if let Some(next) = self.neighbour_para(&from.block, true) {
                let first = self.stops(&next).first().copied().unwrap_or(0);
                return Pos::new(next, first);
            }
        } else {
            if let Some(&p) = stops.iter().rev().find(|&&s| s < from.offset) {
                return Pos::new(from.block.clone(), p);
            }
            if let Some(prev) = self.neighbour_para(&from.block, false) {
                let len = self.para_len(&prev);
                return Pos::new(prev, len);
            }
        }
        from.clone()
    }

    fn step_word(&mut self, from: &Pos, forward: bool) -> Pos {
        let text = self
            .doc
            .body
            .get(&from.block)
            .map(|b| b.content.text())
            .unwrap_or_default();
        let len = self.para_len(&from.block);
        if forward {
            if from.offset >= len {
                return self.step_char(from, true);
            }
            Pos::new(
                from.block.clone(),
                word_forward(&text, from.offset).min(len),
            )
        } else {
            if from.offset == 0 {
                return self.step_char(from, false);
            }
            Pos::new(from.block.clone(), word_backward(&text, from.offset))
        }
    }

    fn move_caret(&mut self, unit: Unit, forward: bool, extend: bool) {
        let focus = self.sel.focus.clone();
        // Arrow keys collapse a selection to its edge.
        if !extend && !self.sel.is_collapsed() && matches!(unit, Unit::Char) {
            let (s, e) = self.ordered();
            self.set_caret(if forward { e } else { s });
            return;
        }
        let target = match unit {
            Unit::Char => self.step_char(&focus, forward),
            Unit::Word => self.step_word(&focus, forward),
            Unit::Line => {
                let Some(caret) = geometry::caret(&self.layout, &self.index, &focus) else {
                    return;
                };
                let goal = *self.goal_x.get_or_insert(caret.x);
                match geometry::vertical(&self.layout, &self.index, &caret, goal, forward) {
                    Some(p) => p,
                    None => {
                        // Past the first or last line: go to the end.
                        let o = self.order();
                        if forward {
                            let last = o.list.last().cloned().unwrap_or(focus.block.clone());
                            let len = self.para_len(&last);
                            Pos::new(last, len)
                        } else {
                            Pos::new(o.list.first().cloned().unwrap_or(focus.block.clone()), 0)
                        }
                    }
                }
            }
            Unit::LineBoundary => match geometry::line_bounds(&self.layout, &self.index, &focus) {
                Some((s, e)) => {
                    if forward {
                        e
                    } else {
                        s
                    }
                }
                None => focus.clone(),
            },
            Unit::Paragraph => {
                if forward {
                    match self.neighbour_para(&focus.block, true) {
                        Some(n) => Pos::new(n, 0),
                        None => Pos::new(focus.block.clone(), self.para_len(&focus.block)),
                    }
                } else if focus.offset > 0 {
                    Pos::new(focus.block.clone(), 0)
                } else {
                    match self.neighbour_para(&focus.block, false) {
                        Some(p) => Pos::new(p, 0),
                        None => focus.clone(),
                    }
                }
            }
            Unit::Document => {
                let o = self.order();
                if forward {
                    let last = o.list.last().cloned().unwrap_or(focus.block.clone());
                    let len = self.para_len(&last);
                    Pos::new(last, len)
                } else {
                    Pos::new(o.list.first().cloned().unwrap_or(focus.block.clone()), 0)
                }
            }
        };
        if extend {
            self.sel.focus = target;
        } else {
            self.set_caret(target);
        }
    }

    // ----- editing -------------------------------------------------------

    fn insert_text(&mut self, text: &str) -> Step {
        let pending = self.pending.take();
        let sel = self.sel.clone();
        let mut txn = Txn::new(&mut self.doc);
        let at = delete_selection(&mut txn, &sel);
        let attrs = pending.unwrap_or_else(|| typing_in(&txn, &at));
        let end = text::insert_text(&mut txn, &at, text, &attrs);
        let step = txn.finish();
        self.set_caret(end);
        step
    }

    fn insert_paragraph(&mut self) -> Step {
        self.pending = None;
        let sel = self.sel.clone();
        let mut txn = Txn::new(&mut self.doc);
        let at = delete_selection(&mut txn, &sel);
        let empty_list_item = txn
            .get(&at.block)
            .is_some_and(|b| b.content.is_empty() && text::has_direct_numbering(&b.props));
        let caret = if empty_list_item {
            // Enter on an empty list item ends the list.
            format::edit_ppr(&mut txn, &at.block, |e| e.set("numPr", None));
            at.clone()
        } else {
            text::split(&mut txn, &at).unwrap_or(at.clone())
        };
        let step = txn.finish();
        self.set_caret(caret);
        step
    }

    fn insert_break(&mut self, kind: BreakKind) -> Step {
        let w = self.doc.w_prefix().to_owned();
        let q = |l: &str| {
            if w.is_empty() {
                l.to_owned()
            } else {
                format!("{w}:{l}")
            }
        };
        let object = match kind {
            BreakKind::Line => None,
            BreakKind::Page => Some(format!("<{} {}=\"page\"/>", q("br"), q("type"))),
            BreakKind::Column => Some(format!("<{} {}=\"column\"/>", q("br"), q("type"))),
        };
        let pending = self.pending.take();
        let sel = self.sel.clone();
        let mut txn = Txn::new(&mut self.doc);
        let at = delete_selection(&mut txn, &sel);
        let mut attrs = pending.unwrap_or_else(|| typing_in(&txn, &at));
        let ch = match &object {
            Some(xml) => {
                attrs = attrs.with(key::OBJ, Some(xml));
                OBJECT_CHAR.to_string()
            }
            // A line break is a newline inside the paragraph.
            None => "\n".to_owned(),
        };
        let mut end = at.clone();
        if let Some(b) = txn.block_mut(&at.block) {
            let o = at.offset.min(b.content.len());
            b.content.insert(o, &ch, attrs);
            end.offset = o + utf16_len(&ch);
            end.upstream = false;
        }
        let step = txn.finish();
        self.set_caret(end);
        step
    }

    fn delete(&mut self, forward: bool, unit: Unit) -> Option<Step> {
        self.pending = None;
        if !self.sel.is_collapsed() {
            let sel = self.sel.clone();
            let mut txn = Txn::new(&mut self.doc);
            let caret = delete_selection(&mut txn, &sel);
            let step = txn.finish();
            self.set_caret(caret);
            return Some(step);
        }
        let at = self.sel.focus.clone();
        let len = self.para_len(&at.block);
        let at_edge = if forward {
            at.offset >= len
        } else {
            at.offset == 0
        };
        if at_edge {
            return self.delete_at_edge(&at, forward);
        }
        let other = match unit {
            Unit::Word => self.step_word(&at, forward),
            Unit::LineBoundary => match geometry::line_bounds(&self.layout, &self.index, &at) {
                Some((s, e)) => {
                    if forward {
                        e
                    } else {
                        s
                    }
                }
                None => at.clone(),
            },
            _ => self.step_char(&at, forward),
        };
        if other.block != at.block {
            return self.delete_at_edge(&at, forward);
        }
        let (s, e) = if forward {
            (at.offset, other.offset)
        } else {
            (other.offset, at.offset)
        };
        if s >= e {
            return None;
        }
        let mut txn = Txn::new(&mut self.doc);
        if let Some(b) = txn.block_mut(&at.block) {
            b.content.delete(s, e);
        }
        let step = txn.finish();
        self.set_caret(Pos::new(at.block.clone(), s));
        Some(step)
    }

    /// Backspace at a paragraph's start or Delete at its end.
    fn delete_at_edge(&mut self, at: &Pos, forward: bool) -> Option<Step> {
        let numbered = self
            .doc
            .body
            .get(&at.block)
            .is_some_and(|b| text::has_direct_numbering(&b.props));
        if !forward && numbered {
            // Backspace at a list item's start removes its number first.
            let mut txn = Txn::new(&mut self.doc);
            format::edit_ppr(&mut txn, &at.block, |e| e.set("numPr", None));
            return Some(txn.finish());
        }
        let other = self.neighbour_para(&at.block, forward)?;
        let (first, second) = if forward {
            (at.block.clone(), other.clone())
        } else {
            (other.clone(), at.block.clone())
        };
        let parent = |s: &Self, id: &BlockId| s.doc.body.get(id).and_then(|b| b.parent.clone());
        let siblings = parent(self, &first) == parent(self, &second);
        let mut txn = Txn::new(&mut self.doc);
        let caret = if siblings {
            text::join(&mut txn, &first, &second)
        } else {
            // Across a table edge: an empty paragraph goes, otherwise the
            // caret just moves.
            let empty = txn.get(&at.block).is_some_and(|b| b.content.is_empty());
            let in_cell = txn
                .get(&at.block)
                .and_then(|b| b.parent.as_ref())
                .and_then(|p| txn.get(p))
                .is_some_and(|p| p.kind == BlockKind::Cell);
            if empty && !in_cell {
                txn.remove(&at.block);
                let len = txn.get(&other).map_or(0, |b| b.content.len());
                Some(Pos::new(other.clone(), if forward { 0 } else { len }))
            } else {
                let len = txn.get(&other).map_or(0, |b| b.content.len());
                Some(Pos::new(other.clone(), if forward { 0 } else { len }))
            }
        };
        let step = txn.finish();
        if let Some(c) = caret {
            self.set_caret(c);
        }
        Some(step)
    }

    /// Applies `f` to the attributes of every selected span (or to the
    /// formatting the next typed text gets, at a caret).
    fn map_runs(&mut self, f: impl Fn(&Attrs) -> Attrs) -> Option<Step> {
        if self.sel.is_collapsed() {
            let at = self.sel.focus.clone();
            let base = self.typing_attrs_at(&at);
            self.pending = Some(f(&base));
            return None;
        }
        let (s, e) = self.ordered();
        let paras = self.paras_between(&s.block, &e.block);
        let mut txn = Txn::new(&mut self.doc);
        for (k, id) in paras.iter().enumerate() {
            let Some(len) = txn.get(id).map(|b| b.content.len()) else {
                continue;
            };
            let from = if k == 0 { s.offset } else { 0 };
            let to = if k + 1 == paras.len() { e.offset } else { len };
            if from >= to {
                continue;
            }
            let before = txn.get(id).map(|b| b.content.clone()).unwrap_or_default();
            let mut content = before.clone();
            // Markers between runs (bookmarks, comment ranges) have no formatting.
            content.map_attrs(from, to, |a| {
                if a.marker().is_some() {
                    a.clone()
                } else {
                    f(a)
                }
            });
            if content != before
                && let Some(b) = txn.block_mut(id)
            {
                b.content = content;
            }
        }
        Some(txn.finish())
    }

    fn toggle(&mut self, t: Toggle) -> Option<Step> {
        let w = self.doc.w_prefix().to_owned();
        let (parts, decls) = self.style_env();
        let formats = Formats::new(
            &parts.styles,
            &parts.numbering,
            &parts.settings,
            &parts.theme,
            &decls,
        );
        let (s, e) = self.ordered();
        let paras = self.paras_between(&s.block, &e.block);
        let mut fmts: HashMap<BlockId, Arc<ParaFormat>> = HashMap::new();
        for id in &paras {
            if let Some(pf) = self.para_format(&formats, id) {
                fmts.insert(id.clone(), pf);
            }
        }
        // On unless the whole selection already has it.
        let mut all_on = true;
        if self.sel.is_collapsed() {
            let attrs = self.typing_attrs_at(&s);
            if let Some(pf) = fmts.get(&s.block) {
                all_on = t.is_on(&formats.run(&attrs, pf));
            }
        } else {
            for (k, id) in paras.iter().enumerate() {
                let (Some(b), Some(pf)) = (self.doc.body.get(id), fmts.get(id)) else {
                    continue;
                };
                let from = if k == 0 { s.offset } else { 0 };
                let to = if k + 1 == paras.len() {
                    e.offset
                } else {
                    b.content.len()
                };
                for (at, span) in b.content.spans_at() {
                    let len = utf16_len(&span.text);
                    if at + len <= from || at >= to || span.attrs.marker().is_some() {
                        continue;
                    }
                    if !t.is_on(&formats.run(&span.attrs, pf)) {
                        all_on = false;
                    }
                }
            }
        }
        let on = !all_on;
        let apply = |a: &Attrs, pf: &Arc<ParaFormat>| {
            let inh = format::inherited(&formats, a, pf, t, &w);
            format::toggled(a, t, on, inh, &w)
        };
        if self.sel.is_collapsed() {
            let base = self.typing_attrs_at(&s);
            if let Some(pf) = fmts.get(&s.block) {
                self.pending = Some(apply(&base, pf));
            }
            return None;
        }
        let mut txn = Txn::new(&mut self.doc);
        for (k, id) in paras.iter().enumerate() {
            let Some(pf) = fmts.get(id) else {
                continue;
            };
            let Some(len) = txn.get(id).map(|b| b.content.len()) else {
                continue;
            };
            let from = if k == 0 { s.offset } else { 0 };
            let to = if k + 1 == paras.len() { e.offset } else { len };
            if from >= to {
                continue;
            }
            let before = txn.get(id).map(|b| b.content.clone()).unwrap_or_default();
            let mut content = before.clone();
            content.map_attrs(from, to, |a| {
                if a.marker().is_some() {
                    a.clone()
                } else {
                    apply(a, pf)
                }
            });
            if content != before
                && let Some(b) = txn.block_mut(id)
            {
                b.content = content;
            }
        }
        Some(txn.finish())
    }

    /// Applies `f` to the `w:pPr` of every selected paragraph.
    fn map_paragraphs(&mut self, f: impl Fn(&mut Element)) -> Option<Step> {
        let (s, e) = self.ordered();
        let paras = self.paras_between(&s.block, &e.block);
        let mut txn = Txn::new(&mut self.doc);
        for id in &paras {
            format::edit_ppr(&mut txn, id, &f);
        }
        Some(txn.finish())
    }
}

/// Deletes the selection inside a transaction; returns the caret.
fn delete_selection(txn: &mut Txn<'_>, sel: &Selection) -> Pos {
    let list = txn.doc.body.paragraphs();
    let index: HashMap<&BlockId, usize> = list.iter().enumerate().map(|(i, id)| (id, i)).collect();
    let (a, f) = (&sel.anchor, &sel.focus);
    let ia = index.get(&a.block).copied().unwrap_or(0);
    let ifo = index.get(&f.block).copied().unwrap_or(0);
    let (s, e) = if (ia, a.offset) <= (ifo, f.offset) {
        (a.clone(), f.clone())
    } else {
        (f.clone(), a.clone())
    };
    if s.same_place(&e) {
        return s;
    }
    text::delete_range(txn, &s, &e)
}

/// The formatting text typed at a position inside a transaction gets.
fn typing_in(txn: &Txn<'_>, at: &Pos) -> Attrs {
    txn.get(&at.block)
        .map(|b| {
            text::typing_attrs(
                b,
                at.offset,
                txn.doc.w_prefix(),
                &SnippetContext::new(txn.doc.decls()),
            )
        })
        .unwrap_or_default()
}
