//! The body paginator: sections, columns, pages, keep rules, notes.

mod floats;
mod notes;
mod paragraphs;
mod tables;

use super::super::inline::{FieldValues, Kind};
use super::super::{Chrome, Item, Page, ParaBox, StoryRef};
use super::anchors::PageGeom;
use super::stack::{ParaCtx, PrevPara, Stack, StackCtx, para_box, stack_story};
use super::{Env, offset_items};
use crate::model::block::{Block, BlockId, BlockKind};
use crate::model::section::{HeaderRefs, PageVAlign, Section, SectionStart};
use floats::{Band, OnPage, place_anchors, place_frames};
use pptx_engine::path::Rect;
use std::collections::HashMap;
use std::sync::Arc;

const EPS: f32 = 0.01;

/// Columns this close in width take the same line breaks.
const COLUMN_SLACK: f32 = 0.5;

/// Default distance of line numbers from the text.
const LINE_NUMBER_DISTANCE: f32 = 18.0;

/// The compatibility mode of Word 2013 and later.
const MODERN_COMPAT: u32 = 15;

struct Cur {
    page: Page,
    sect: usize,
    col: usize,
    top: f32,
    bottom: f32,
    y: f32,
    body: Vec<Item>,
    behind: Vec<Item>,
    front: Vec<Item>,
    chrome: Vec<Item>,
    notes: Vec<i64>,
    notes_height: f32,
    placed_any: bool,
    hard: bool,
    line_on_page: u32,
    /// Stretches of the page that body text skips (floats that allow no
    /// text beside them).
    bands: Vec<Band>,
    /// Where the columns of the current section start on this page (below
    /// what earlier sections left on it).
    sect_top: f32,
    /// The lowest point the current section's columns reached on this page.
    sect_bottom: f32,
}

pub(in crate::layout) struct Flow<'e, 'a> {
    env: &'e Env<'a>,
    sections: Vec<Section>,
    refs: Vec<(HeaderRefs, HeaderRefs)>,
    pages: Vec<Page>,
    cur: Option<Cur>,
    page_number: i64,
    section_started: Vec<bool>,
    prev: Option<PrevPara>,
    line_no: u32,
    boxes: HashMap<BlockId, Arc<ParaBox>>,
    note_stacks: HashMap<i64, Stack>,
    separator: Option<Stack>,
    /// Height of the footnote continuation notice, once measured.
    notice: Option<f32>,
    total_pages: i64,
}

impl<'e, 'a> Flow<'e, 'a> {
    pub fn new(
        env: &'e Env<'a>,
        sections: Vec<Section>,
        refs: Vec<(HeaderRefs, HeaderRefs)>,
        total_pages: i64,
    ) -> Self {
        let n = sections.len();
        Self {
            env,
            sections,
            refs,
            pages: Vec::new(),
            cur: None,
            page_number: 0,
            section_started: vec![false; n],
            prev: None,
            line_no: 0,
            boxes: HashMap::new(),
            note_stacks: HashMap::new(),
            separator: None,
            notice: None,
            total_pages,
        }
    }

    /// Whether paragraph spacing adds up (Word 2003) instead of collapsing.
    fn sum_spacing(&self) -> bool {
        !self.env.doc.parts().settings.html_auto_spacing
    }

    fn section(&self) -> &Section {
        let s = self.cur.as_ref().map_or(0, |c| c.sect);
        &self.sections[s.min(self.sections.len() - 1)]
    }

    fn col_geom(&self) -> (f32, f32) {
        let s = self.section();
        let col = self
            .cur
            .as_ref()
            .map_or(0, |c| c.col)
            .min(s.columns.len().saturating_sub(1));
        let mut x = s.left + s.gutter;
        for c in &s.columns[..col] {
            x += c.width + c.space;
        }
        (x, s.columns.get(col).map_or(s.text_width(), |c| c.width))
    }

    fn page_geom(&self) -> PageGeom {
        let s = self.section();
        let (col_left, col_width) = self.col_geom();
        PageGeom {
            width: s.page_w,
            height: s.page_h,
            left: s.left,
            right: s.right,
            top: s.top,
            bottom: s.bottom,
            col_left,
            col_width,
        }
    }

    fn fields(&self) -> FieldValues {
        FieldValues {
            page: self.page_number.max(1),
            pages: self.total_pages.max(1),
            section_pages: self.total_pages.max(1),
            page_fmt: self.section().page_fmt.clone(),
        }
    }

    /// Lays out a header or footer story for the current page.
    fn hf_stack(
        &self,
        rid: Option<&String>,
        sect: &Section,
        fields: &FieldValues,
    ) -> Option<Stack> {
        let part = self.env.hf_part(rid?)?;
        let ps = self.env.doc.part_story(&part)?;
        Some(stack_story(
            self.env,
            &ps.story,
            None,
            &StackCtx {
                story: StoryRef::Part(part),
                width: sect.text_width(),
                table: Default::default(),
                fields: fields.clone(),
                note_number: None,
                float_frames: true,
                page: Some(PageGeom {
                    width: sect.page_w,
                    height: sect.page_h,
                    left: sect.left,
                    right: sect.right,
                    top: sect.top,
                    bottom: sect.bottom,
                    col_left: sect.left + sect.gutter,
                    col_width: sect.text_width(),
                }),
            },
        ))
    }

    fn start_page(&mut self, sect: usize, hard: bool) {
        self.finish_page();
        let s = self.sections[sect].clone();
        let first_of_section = !self.section_started[sect];
        self.section_started[sect] = true;
        self.page_number = match (first_of_section, s.page_start) {
            (true, Some(start)) => start,
            _ => self.page_number + 1,
        };
        // Odd and even section starts insert a blank page when needed.
        if first_of_section
            && ((s.start == SectionStart::OddPage && self.page_number % 2 == 0)
                || (s.start == SectionStart::EvenPage && self.page_number % 2 != 0))
            && !self.pages.is_empty()
        {
            self.pages.push(Page {
                width: s.page_w,
                height: s.page_h,
                section: sect,
                number: self.page_number,
                behind: Vec::new(),
                items: Vec::new(),
                front: Vec::new(),
                body: Rect::from_xywh(s.left, s.top, s.text_width(), s.page_h - s.top - s.bottom),
                header: None,
                footer: None,
            });
            self.page_number += 1;
        }
        let settings = &self.env.doc.parts().settings;
        let (headers, footers) = self.refs[sect.min(self.refs.len() - 1)].clone();
        let pick = |r: &HeaderRefs| -> Option<String> {
            if first_of_section && s.title_page {
                return r.first.clone();
            }
            if settings.even_and_odd_headers && self.page_number % 2 == 0 {
                return r.even.clone();
            }
            r.default.clone()
        };
        let fields = FieldValues {
            page: self.page_number,
            pages: self.total_pages.max(1),
            section_pages: self.total_pages.max(1),
            page_fmt: s.page_fmt.clone(),
        };
        let header_rid = pick(&headers);
        let footer_rid = pick(&footers);
        let header_part = header_rid.as_ref().and_then(|r| self.env.hf_part(r));
        let footer_part = footer_rid.as_ref().and_then(|r| self.env.hf_part(r));
        let header = self.hf_stack(header_rid.as_ref(), &s, &fields);
        let footer = self.hf_stack(footer_rid.as_ref(), &s, &fields);
        let mut chrome = Vec::new();
        let mut behind = Vec::new();
        let mut front = Vec::new();
        let mut top = s.top;
        let mut bottom = s.page_h - s.bottom;
        let geom = PageGeom {
            width: s.page_w,
            height: s.page_h,
            left: s.left,
            right: s.right,
            top: s.top,
            bottom: s.bottom,
            col_left: s.left,
            col_width: s.text_width(),
        };
        let on_page = OnPage {
            env: self.env,
            fields: &fields,
            geom: &geom,
        };
        if let Some(mut h) = header {
            offset_items(&mut h.items, s.left + s.gutter, s.header);
            for a in &mut h.anchors {
                a.shift(s.left, s.header);
            }
            if !s.top_exact {
                top = top.max(s.header + h.height);
            }
            chrome.extend(h.items);
            place_anchors(&on_page, &h.anchors, &mut behind, &mut front);
            place_frames(
                &on_page,
                &mut h.frames,
                (s.left + s.gutter, s.header),
                &mut chrome,
                &mut behind,
                &mut front,
            );
        }
        if let Some(mut f) = footer {
            let y = s.page_h - s.footer - f.height;
            offset_items(&mut f.items, s.left + s.gutter, y);
            for a in &mut f.anchors {
                a.shift(s.left, y);
            }
            if !s.bottom_exact {
                bottom = bottom.min(y);
            }
            chrome.extend(f.items);
            place_anchors(&on_page, &f.anchors, &mut behind, &mut front);
            place_frames(
                &on_page,
                &mut f.frames,
                (s.left + s.gutter, y),
                &mut chrome,
                &mut behind,
                &mut front,
            );
        }
        let page = Page {
            width: s.page_w,
            height: s.page_h,
            section: sect,
            number: self.page_number,
            behind: Vec::new(),
            items: Vec::new(),
            front: Vec::new(),
            body: Rect::from_xywh(s.left, top, s.text_width(), bottom - top),
            header: Some(Chrome {
                part: header_part,
                top: 0.0,
                bottom: top,
            }),
            footer: Some(Chrome {
                part: footer_part,
                top: bottom,
                bottom: s.page_h,
            }),
        };
        self.cur = Some(Cur {
            page,
            sect,
            col: 0,
            top,
            bottom,
            y: top,
            body: Vec::new(),
            behind,
            front,
            chrome,
            notes: Vec::new(),
            notes_height: 0.0,
            placed_any: false,
            hard,
            line_on_page: 0,
            bands: Vec::new(),
            sect_top: top,
            sect_bottom: top,
        });
    }

    fn finish_page(&mut self) {
        let Some(mut cur) = self.cur.take() else {
            return;
        };
        let s = self.sections[cur.sect.min(self.sections.len() - 1)].clone();
        // Vertical alignment of the body.
        if cur.col == 0 && s.v_align != PageVAlign::Top && !cur.body.is_empty() {
            let used = cur.y - cur.top;
            let free = (cur.bottom - cur.notes_height - cur.top - used).max(0.0);
            let dy = match s.v_align {
                PageVAlign::Center => free / 2.0,
                PageVAlign::Bottom => free,
                _ => 0.0,
            };
            if dy > 0.0 {
                offset_items(&mut cur.body, 0.0, dy);
            }
        }
        // Notes at the bottom of the page.
        if !cur.notes.is_empty() {
            let mut y = cur.bottom - cur.notes_height;
            let x = s.left + s.gutter;
            if let Some(sep) = self.separator_stack() {
                let mut items = sep.items.clone();
                offset_items(&mut items, x, y);
                cur.body.extend(items);
                y += sep.height;
            }
            for id in &cur.notes {
                if let Some(st) = self.note_stacks.get(id) {
                    let mut items = st.items.clone();
                    offset_items(&mut items, x, y);
                    cur.body.extend(items);
                    y += st.height;
                }
            }
        }
        cur.page.behind = cur.behind;
        let mut items = cur.chrome;
        items.extend(cur.body);
        cur.page.items = items;
        cur.page.front = cur.front;
        if let Some(b) = s.borders {
            let (w, h) = (s.page_w, s.page_h);
            let (l, t, r, bt) = if b.from_page_edge {
                (
                    b.left.map_or(24.0, |x| x.space),
                    b.top.map_or(24.0, |x| x.space),
                    w - b.right.map_or(24.0, |x| x.space),
                    h - b.bottom.map_or(24.0, |x| x.space),
                )
            } else {
                (
                    s.left - b.left.map_or(4.0, |x| x.space),
                    s.top - b.top.map_or(1.0, |x| x.space),
                    w - s.right + b.right.map_or(4.0, |x| x.space),
                    h - s.bottom + b.bottom.map_or(1.0, |x| x.space),
                )
            };
            for (border, x0, y0, x1, y1) in [
                (b.top, l, t, r, t),
                (b.bottom, l, bt, r, bt),
                (b.left, l, t, l, bt),
                (b.right, r, t, r, bt),
            ] {
                if let Some(border) = border {
                    cur.page.behind.push(Item::Rule {
                        x0,
                        y0,
                        x1,
                        y1,
                        border,
                    });
                }
            }
        }
        self.pages.push(cur.page);
    }

    /// Moves to the next column, or the next page after the last column.
    fn next_column(&mut self, hard: bool) {
        let (sect, col, cols) = match &self.cur {
            Some(c) => (c.sect, c.col, self.sections[c.sect].columns.len()),
            None => return,
        };
        if col + 1 < cols {
            if let Some(c) = &mut self.cur {
                // The next column starts where the section started on the page.
                c.sect_bottom = c.sect_bottom.max(c.y);
                c.col += 1;
                c.y = c.sect_top;
                c.placed_any = false;
                c.hard = hard;
            }
        } else {
            self.start_page(sect, hard);
        }
        self.prev = None;
    }

    fn para(&mut self, b: &Block, width: f32) -> Arc<ParaBox> {
        if let Some(pb) = self.boxes.get(&b.id) {
            let fits = (pb
                .lines
                .lines
                .first()
                .map_or(width, |l| l.right + pb.format.props.ind_right)
                - width)
                .abs()
                < 0.5;
            if fits && !pb.inline.dynamic {
                return Arc::clone(pb);
            }
        }
        let pb = para_box(
            self.env,
            b,
            &ParaCtx {
                story: &StoryRef::Body,
                width,
                table: &Default::default(),
                fields: &self.fields(),
                note_number: None,
                grid: self.grid(),
            },
        );
        self.boxes.insert(b.id.clone(), Arc::clone(&pb));
        pb
    }

    pub fn run(&mut self, blocks: &[&Block], section_of: &[usize]) {
        let mut cur_section = usize::MAX;
        let mut skip_to = 0;
        for (i, b) in blocks.iter().enumerate() {
            if i < skip_to {
                continue;
            }
            let s = section_of[i].min(self.sections.len() - 1);
            if self.cur.is_none() {
                self.start_page(s, false);
                cur_section = s;
            } else if s != cur_section {
                cur_section = s;
                // Word 2013 and later keep the space before of a section's
                // first paragraph, as after a page break; earlier versions
                // drop it, as at any page top.
                let hard = self.env.doc.parts().settings.compat_mode >= MODERN_COMPAT;
                match self.sections[s].start {
                    SectionStart::Continuous => {
                        let same_size = {
                            let old = self.section();
                            let new = &self.sections[s];
                            (old.page_w - new.page_w).abs() < 1.0
                                && (old.page_h - new.page_h).abs() < 1.0
                        };
                        if same_size {
                            self.section_started[s] = true;
                            if let Some(c) = &mut self.cur {
                                // Below everything the previous section's
                                // columns hold on the page.
                                let y = c.sect_bottom.max(c.y);
                                c.sect = s;
                                c.col = 0;
                                c.y = y;
                                c.sect_top = y;
                                c.sect_bottom = y;
                            }
                        } else {
                            self.start_page(s, hard);
                        }
                    }
                    SectionStart::NextColumn => {
                        if let Some(c) = &mut self.cur {
                            c.sect = s;
                        }
                        self.section_started[s] = true;
                        self.next_column(hard);
                    }
                    _ => self.start_page(s, hard),
                }
            }
            match b.kind {
                BlockKind::Paragraph if self.bare_section_end(blocks, i, section_of) => {}
                BlockKind::Paragraph => match self.place_frame(blocks, i) {
                    Some(end) => skip_to = end,
                    None => self.place_paragraph(blocks, i),
                },
                BlockKind::Table => self.place_table(b),
                _ => {}
            }
        }
        if self.cur.is_none() {
            self.start_page(self.sections.len() - 1, false);
        }
        self.place_endnotes();
    }

    /// Whether `blocks[i]` is an empty paragraph that only ends a section and
    /// takes no room: before a section going on on the same page below text
    /// (for a section of several columns, the columns end with the text),
    /// or, ending columns, when it would start a page of its own.
    fn bare_section_end(&mut self, blocks: &[&Block], i: usize, section_of: &[usize]) -> bool {
        let (Some(&s), Some(&next)) = (section_of.get(i), section_of.get(i + 1)) else {
            return false;
        };
        if s == next {
            return false;
        }
        let columns = self.sections.get(s).is_some_and(|c| c.columns.len() > 1);
        let placed_any = self.cur.as_ref().is_some_and(|c| c.placed_any);
        if !columns && !placed_any {
            return false;
        }
        let (_, width) = self.col_geom();
        let pb = self.para(blocks[i], width);
        let empty = pb.inline.label_len == 0
            && pb
                .inline
                .clusters
                .iter()
                .all(|c| matches!(c.kind, Kind::End | Kind::Zero));
        if !empty {
            return false;
        }
        let continuous = self
            .sections
            .get(next)
            .is_some_and(|n| n.start == SectionStart::Continuous);
        let y = self.cur.as_ref().map_or(0.0, |c| c.y);
        continuous || (columns && y + pb.lines.height > self.avail_bottom() + EPS)
    }

    /// The pitch lines snap to in the current section, if they do.
    fn grid(&self) -> Option<f32> {
        let s = self.section();
        (s.grid.snap_lines && s.grid.line_pitch > 0.0).then_some(s.grid.line_pitch)
    }

    pub fn finish(mut self) -> Vec<Page> {
        self.finish_page();
        self.pages
    }
}
