//! Paginated layout.
//!
//! [`Document::layout`] turns the document into pages of placed items:
//! lines of text, shading and borders, drawings. Paragraphs are measured
//! into clusters ([`inline`]), broken into lines ([`lines`]), and flowed into
//! columns and pages ([`flow`]) with Word's rules for spacing, keeping lines
//! together, widows and orphans, sections, headers, footers and notes.

pub mod drawing;
mod flow;
pub mod fonts;
pub mod format;
pub mod inline;
pub mod lines;
mod table;

use crate::document::Document;
use crate::model::block::BlockId;
use crate::model::props::Border;
use format::ParaFormat;
use inline::Inline;
use lines::Lines;
use pptx_engine::font::FontDb;
use pptx_engine::model::color::Rgba;
use pptx_engine::path::Rect;
use std::sync::{Arc, Mutex};

pub use flow::LayoutOptions;

/// Which story a paragraph belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum StoryRef {
    /// The body.
    Body,
    /// A header or footer part.
    Part(String),
    /// A footnote.
    Footnote(i64),
    /// An endnote.
    Endnote(i64),
    /// A text box inside a drawing (anchor paragraph and drawing index).
    TextBox(BlockId, u16),
}

/// A laid-out paragraph, shared by the lines that show it.
#[derive(Debug)]
pub struct ParaBox {
    /// The story.
    pub story: StoryRef,
    /// The paragraph block.
    pub block: BlockId,
    /// Its clusters.
    pub inline: Inline,
    /// Its lines.
    pub lines: Lines,
    /// Its formatting.
    pub format: Arc<ParaFormat>,
}

/// A line placed on a page.
#[derive(Clone, Debug)]
pub struct PlacedLine {
    /// The paragraph.
    pub para: Arc<ParaBox>,
    /// Line index within the paragraph.
    pub line: usize,
    /// Page x of the paragraph's text area left edge.
    pub x: f32,
    /// Page y of the line's top.
    pub y: f32,
    /// Clip rectangle (cells with an exact height).
    pub clip: Option<Rect>,
}

impl PlacedLine {
    /// The line.
    pub fn line(&self) -> &lines::Line {
        &self.para.lines.lines[self.line]
    }

    /// Page y of the baseline.
    pub fn baseline(&self) -> f32 {
        self.y + self.line().baseline
    }
}

/// A drawing placed on a page.
#[derive(Clone, Debug)]
pub struct PlacedDrawing {
    /// The drawing.
    pub drawing: Arc<drawing::Drawing>,
    /// Its box on the page (without effect extents).
    pub rect: Rect,
    /// Story of the paragraph that holds it (for part relationships).
    pub story: StoryRef,
}

/// Something drawn on a page.
#[derive(Clone, Debug)]
pub enum Item {
    /// A line of text.
    Line(PlacedLine),
    /// A filled rectangle (shading).
    Fill {
        /// Area.
        rect: Rect,
        /// Color.
        color: Rgba,
    },
    /// A border segment from (x0, y0) to (x1, y1).
    Rule {
        /// Start x.
        x0: f32,
        /// Start y.
        y0: f32,
        /// End x.
        x1: f32,
        /// End y.
        y1: f32,
        /// Border style.
        border: Border,
    },
    /// A drawing.
    Drawing(PlacedDrawing),
    /// A line number in the margin.
    LineNumber {
        /// Text.
        text: String,
        /// Right edge x.
        right: f32,
        /// Baseline y.
        baseline: f32,
        /// Font size.
        size: f32,
        /// Font family.
        font: String,
    },
}

/// One page.
#[derive(Clone, Debug)]
pub struct Page {
    /// Width (points).
    pub width: f32,
    /// Height (points).
    pub height: f32,
    /// Section index.
    pub section: usize,
    /// Displayed page number.
    pub number: i64,
    /// Items behind the text (floats behind, page borders).
    pub behind: Vec<Item>,
    /// Body, headers, footers and notes.
    pub items: Vec<Item>,
    /// Items in front of the text.
    pub front: Vec<Item>,
    /// The body text area (for editors).
    pub body: Rect,
    /// The header area, above the body.
    pub header: Option<Chrome>,
    /// The footer area, below the body.
    pub footer: Option<Chrome>,
}

/// A page's header or footer area, for editors.
#[derive(Clone, Debug, PartialEq)]
pub struct Chrome {
    /// The part shown there (`None` when the section has none for the page).
    pub part: Option<String>,
    /// Top (points).
    pub top: f32,
    /// Bottom (points).
    pub bottom: f32,
}

impl Page {
    /// Every item in paint order.
    pub fn all_items(&self) -> impl Iterator<Item = &Item> {
        self.behind.iter().chain(&self.items).chain(&self.front)
    }

    /// Placed lines of one story.
    pub fn lines_of<'a>(
        &'a self,
        story: &'a StoryRef,
    ) -> impl Iterator<Item = &'a PlacedLine> + 'a {
        self.items.iter().filter_map(move |i| match i {
            Item::Line(l) if &l.para.story == story => Some(l),
            _ => None,
        })
    }
}

/// A laid-out document.
#[derive(Clone, Debug, Default)]
pub struct Layout {
    /// The pages.
    pub pages: Vec<Page>,
}

/// What a measured paragraph depends on besides its own content.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ParaKey {
    pub version: u64,
    pub generation: u64,
    pub width: u32,
    pub table: u64,
    pub label: Option<(String, String)>,
    pub grid: u32,
    pub markup: bool,
    pub note_number: Option<String>,
}

#[derive(Debug)]
struct Cached {
    key: ParaKey,
    pb: Arc<ParaBox>,
    epoch: u64,
}

/// Paragraph measurements kept between layouts, so laying out again after
/// an edit re-measures only the paragraphs the edit touched.
#[derive(Debug, Default)]
pub struct LayoutCache {
    /// Per paragraph, the boxes of its last pass: a few, since one pass can
    /// lay a paragraph out more than once (a table cell measured for the
    /// column widths, then laid out at its width).
    paras: Mutex<(u64, crate::hash::FxMap<(StoryRef, BlockId), Vec<Cached>>)>,
    /// Paragraphs showing page fields, by the values they show (a footer's
    /// page number on every page).
    dynamic: Mutex<crate::hash::FxMap<(StoryRef, BlockId, u64), Cached>>,
    /// Resolved formats of one style sheet generation.
    formats: Mutex<Option<(u64, Arc<format::FormatCache>)>>,
    /// Page count of the last layout (the first guess for page-count fields).
    pages: Mutex<Option<usize>>,
}

impl LayoutCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn get(
        &self,
        story: &StoryRef,
        block: &BlockId,
        key: &ParaKey,
    ) -> Option<Arc<ParaBox>> {
        let mut guard = self.paras.lock().unwrap_or_else(|e| e.into_inner());
        let epoch = guard.0;
        let hit = guard
            .1
            .get_mut(&(story.clone(), block.clone()))?
            .iter_mut()
            .find(|c| c.key == *key)?;
        hit.epoch = epoch;
        Some(Arc::clone(&hit.pb))
    }

    pub(crate) fn put(&self, story: &StoryRef, block: &BlockId, key: ParaKey, pb: Arc<ParaBox>) {
        /// Boxes kept per paragraph.
        const KEEP: usize = 4;
        let mut guard = self.paras.lock().unwrap_or_else(|e| e.into_inner());
        let epoch = guard.0;
        let list = guard.1.entry((story.clone(), block.clone())).or_default();
        list.retain(|c| c.key != key);
        if list.len() >= KEEP {
            // The least recently used goes.
            if let Some(oldest) = (0..list.len()).min_by_key(|&i| list[i].epoch) {
                list.remove(oldest);
            }
        }
        list.push(Cached { key, pb, epoch });
    }

    /// A paragraph with page fields, as laid out for these field values.
    pub(crate) fn get_dynamic(
        &self,
        story: &StoryRef,
        block: &BlockId,
        fields: u64,
        key: &ParaKey,
    ) -> Option<Arc<ParaBox>> {
        let epoch = self.paras.lock().unwrap_or_else(|e| e.into_inner()).0;
        let mut guard = self.dynamic.lock().unwrap_or_else(|e| e.into_inner());
        let hit = guard.get_mut(&(story.clone(), block.clone(), fields))?;
        if hit.key != *key {
            return None;
        }
        hit.epoch = epoch;
        Some(Arc::clone(&hit.pb))
    }

    pub(crate) fn put_dynamic(
        &self,
        story: &StoryRef,
        block: &BlockId,
        fields: u64,
        key: ParaKey,
        pb: Arc<ParaBox>,
    ) {
        let epoch = self.paras.lock().unwrap_or_else(|e| e.into_inner()).0;
        self.dynamic
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                (story.clone(), block.clone(), fields),
                Cached { key, pb, epoch },
            );
    }

    /// Starts a layout pass.
    pub(crate) fn begin(&self) {
        let mut guard = self.paras.lock().unwrap_or_else(|e| e.into_inner());
        guard.0 += 1;
    }

    /// Ends a layout pass, dropping paragraphs it did not use.
    pub(crate) fn end(&self) {
        let mut guard = self.paras.lock().unwrap_or_else(|e| e.into_inner());
        let epoch = guard.0;
        guard.1.retain(|_, list| {
            list.retain(|c| c.epoch == epoch);
            !list.is_empty()
        });
        drop(guard);
        self.dynamic
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, c| c.epoch == epoch);
    }

    /// The format cache for a style sheet generation.
    pub(crate) fn formats(&self, generation: u64) -> Arc<format::FormatCache> {
        let mut guard = self.formats.lock().unwrap_or_else(|e| e.into_inner());
        match &*guard {
            Some((g, cache)) if *g == generation => Arc::clone(cache),
            _ => {
                let cache = Arc::new(format::FormatCache::default());
                *guard = Some((generation, Arc::clone(&cache)));
                cache
            }
        }
    }

    /// The last layout's page count.
    pub(crate) fn last_pages(&self) -> Option<usize> {
        *self.pages.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn set_last_pages(&self, pages: usize) {
        *self.pages.lock().unwrap_or_else(|e| e.into_inner()) = Some(pages);
    }

    /// Number of cached paragraphs.
    pub fn len(&self) -> usize {
        self.paras.lock().map_or(0, |g| g.1.len())
    }

    /// Whether nothing is cached.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Document {
    /// Lays the document out into pages.
    pub fn layout(&self, fonts: &FontDb) -> Layout {
        self.layout_with(fonts, &LayoutOptions::default())
    }

    /// Lays the document out with options.
    pub fn layout_with(&self, fonts: &FontDb, options: &LayoutOptions) -> Layout {
        flow::layout(self, fonts, options, None)
    }

    /// Lays the document out, reusing paragraph measurements from `cache`
    /// (and leaving this layout's in it).
    pub fn layout_cached(
        &self,
        fonts: &FontDb,
        options: &LayoutOptions,
        cache: &LayoutCache,
    ) -> Layout {
        cache.begin();
        let layout = flow::layout(self, fonts, options, Some(cache));
        cache.end();
        layout
    }
}
