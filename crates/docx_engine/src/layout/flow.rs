//! Flowing the body into pages and columns.

mod anchors;
mod body;
mod frames;
mod split;
mod stack;
mod textbox;

use super::fonts::Fonts;
use super::format::{Formats, TableCtx};
use super::{Item, Layout};
use crate::document::{Document, rel_kind};
use crate::model::block::{Block, BlockId, BlockKind, Story};
use crate::model::content::{OBJECT_CHAR, key};
use crate::model::numbering::{Counters, Label, format_number};
use crate::model::props::RunProps;
use crate::model::section::{HeaderRefs, Section};
use pptx_engine::font::FontDb;
use std::collections::HashMap;

pub(super) use stack::TableCache;

/// Layout choices.
#[derive(Clone, Debug)]
pub struct LayoutOptions {
    /// Show tracked changes inline (else the document as if accepted).
    pub markup: bool,
    /// Keep a paragraph's space before when it lands at the top of a page
    /// after a natural page break (Word drops it: off by default).
    pub space_before_at_page_top: bool,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            markup: true,
            space_before_at_page_top: false,
        }
    }
}

/// Everything layout reads.
pub(super) struct Env<'a> {
    pub doc: &'a Document,
    pub formats: Formats<'a>,
    pub fonts: Fonts<'a>,
    pub options: &'a LayoutOptions,
    /// Displayed note numbers by (endnote, id).
    pub note_numbers: HashMap<(bool, i64), String>,
    /// List labels of numbered paragraphs.
    pub labels: HashMap<BlockId, (Label, RunProps)>,
    /// Measurements kept between layouts.
    pub cache: Option<&'a super::LayoutCache>,
}

impl<'a> Env<'a> {
    fn new(
        doc: &'a Document,
        fonts: &'a FontDb,
        options: &'a LayoutOptions,
        cache: Option<&'a super::LayoutCache>,
    ) -> Self {
        let parts = doc.parts();
        let mut formats = Formats::new(
            &parts.styles,
            &parts.numbering,
            &parts.settings,
            &parts.theme,
            doc.decls(),
        );
        if let Some(c) = cache {
            formats = formats.with_cache(c.formats(doc.generation));
        }
        Env {
            doc,
            formats,
            fonts: Fonts::new(fonts),
            options,
            note_numbers: HashMap::new(),
            labels: HashMap::new(),
            cache,
        }
    }

    /// Numbers notes in order of reference and computes list labels.
    fn prepare(&mut self) {
        let body = &self.doc.body;
        let settings = &self.doc.parts().settings;
        let mut counters = Counters::default();
        let mut footnote = settings.footnotes.start;
        let mut endnote = settings.endnotes.start;
        let mut labels = HashMap::new();
        let mut numbers = HashMap::new();
        let formats = &self.formats;
        body.walk(|b, _| {
            if b.kind != BlockKind::Paragraph {
                return;
            }
            let fmt = formats.paragraph(&b.props, &TableCtx::default());
            if let Some((num_id, ilvl)) = fmt.props.num
                && !fmt.mark.vanish
                && let Some(label) = counters.next(formats.numbering, formats.styles, num_id, ilvl)
            {
                let props = formats.label_props(&fmt, &label);
                labels.insert(b.id.clone(), (label, props));
            }
            for (_, span) in b.content.spans_at() {
                let Some(obj) = span.attrs.get(key::OBJ) else {
                    continue;
                };
                for _ in span.text.chars().filter(|c| *c == OBJECT_CHAR) {
                    let endnote_ref = obj.contains("endnoteReference");
                    if !(endnote_ref || obj.contains("footnoteReference")) {
                        continue;
                    }
                    let Some(id) = note_id(obj) else {
                        continue;
                    };
                    if numbers.contains_key(&(endnote_ref, id)) {
                        continue;
                    }
                    let (fmt, n) = if endnote_ref {
                        endnote += 1;
                        (&settings.endnotes.fmt, endnote - 1)
                    } else {
                        footnote += 1;
                        (&settings.footnotes.fmt, footnote - 1)
                    };
                    numbers.insert((endnote_ref, id), format_number(n, fmt));
                }
            }
        });
        self.labels = labels;
        self.note_numbers = numbers;
    }

    /// The list label of a paragraph outside the body (headers, footers,
    /// notes), counted on its own.
    fn story_label(&self, block: &Block, table: &TableCtx) -> Option<(Label, RunProps)> {
        let fmt = self.formats.paragraph(&block.props, table);
        let (num_id, ilvl) = fmt.props.num?;
        if fmt.mark.vanish {
            return None;
        }
        let label =
            Counters::default().next(self.formats.numbering, self.formats.styles, num_id, ilvl)?;
        let props = self.formats.label_props(&fmt, &label);
        Some((label, props))
    }

    /// The part a section's header/footer reference points to.
    fn hf_part(&self, rid: &str) -> Option<String> {
        let rels = self.doc.main_rels();
        rels.get(rid)
            .filter(|r| matches!(rel_kind(&r.rel_type), "header" | "footer"))
            .map(|r| rels.resolve(r))
    }
}

fn note_id(xml: &str) -> Option<i64> {
    let i = xml
        .find(":id=\"")
        .map(|i| i + 5)
        .or_else(|| xml.find(" id=\"").map(|i| i + 5))?;
    let rest = &xml[i..];
    let end = rest.find('"')?;
    crate::xml::parse_int(&rest[..end])
}

/// Body blocks in flow order, with content controls opened up.
pub(super) fn flow_blocks<'s>(
    story: &'s Story,
    parent: Option<&BlockId>,
    out: &mut Vec<&'s Block>,
) {
    for id in story.children(parent) {
        let Some(b) = story.get(id) else {
            continue;
        };
        match b.kind {
            BlockKind::Paragraph | BlockKind::Table => out.push(b),
            BlockKind::Container => flow_blocks(story, Some(id), out),
            BlockKind::Row | BlockKind::Cell | BlockKind::Opaque => {}
        }
    }
}

/// Header and footer references with inheritance from earlier sections.
fn effective_refs(sections: &[Section]) -> Vec<(HeaderRefs, HeaderRefs)> {
    let mut out: Vec<(HeaderRefs, HeaderRefs)> = Vec::with_capacity(sections.len());
    let mut last = (HeaderRefs::default(), HeaderRefs::default());
    for s in sections {
        let merge = |own: &HeaderRefs, prev: &HeaderRefs| HeaderRefs {
            default: own.default.clone().or_else(|| prev.default.clone()),
            first: own.first.clone().or_else(|| prev.first.clone()),
            even: own.even.clone().or_else(|| prev.even.clone()),
        };
        last = (merge(&s.headers, &last.0), merge(&s.footers, &last.1));
        out.push(last.clone());
    }
    out
}

/// Lays out a document.
pub(super) fn layout(
    doc: &Document,
    fonts: &FontDb,
    options: &LayoutOptions,
    cache: Option<&super::LayoutCache>,
) -> Layout {
    let mut env = Env::new(doc, fonts, options, cache);
    env.prepare();
    let mut blocks: Vec<&Block> = Vec::new();
    flow_blocks(&doc.body, None, &mut blocks);
    // Sections: each paragraph carrying a sectPr closes one.
    let mut sections: Vec<Section> = Vec::new();
    let mut section_of: Vec<usize> = Vec::with_capacity(blocks.len());
    for b in &blocks {
        section_of.push(sections.len());
        if b.kind == BlockKind::Paragraph
            && let Some(s) = env
                .formats
                .paragraph(&b.props, &TableCtx::default())
                .section
                .clone()
        {
            sections.push(s);
        }
    }
    sections.push(doc.final_section());
    let refs = effective_refs(&sections);
    // Page-count fields need the page count: lay out again when the first
    // pass's guess (the last layout's count) was wrong.
    let mut total = cache.and_then(|c| c.last_pages()).unwrap_or(1) as i64;
    let mut pages = Vec::new();
    for _ in 0..3 {
        let mut flow = body::Flow::new(&env, sections.clone(), refs.clone(), total);
        flow.run(&blocks, &section_of);
        pages = flow.finish();
        let count = pages.len() as i64;
        if count == total {
            break;
        }
        total = count;
    }
    if let Some(c) = cache {
        c.set_last_pages(pages.len());
    }
    Layout { pages }
}

/// Offsets every item by (dx, dy).
pub(super) fn offset_items(items: &mut [Item], dx: f32, dy: f32) {
    for item in items {
        match item {
            Item::Line(l) => {
                l.x += dx;
                l.y += dy;
                if let Some(c) = &mut l.clip {
                    c.x += dx;
                    c.y += dy;
                }
            }
            Item::Fill { rect, .. } => {
                rect.x += dx;
                rect.y += dy;
            }
            Item::Rule { x0, y0, x1, y1, .. } => {
                *x0 += dx;
                *x1 += dx;
                *y0 += dy;
                *y1 += dy;
            }
            Item::Drawing(d) => {
                d.rect.x += dx;
                d.rect.y += dy;
            }
            Item::LineNumber {
                right, baseline, ..
            } => {
                *right += dx;
                *baseline += dy;
            }
        }
    }
}

#[cfg(test)]
mod test;
