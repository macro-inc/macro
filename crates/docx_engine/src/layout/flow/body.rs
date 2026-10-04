//! The body paginator: sections, columns, pages, keep rules, notes.

mod floats;
mod notes;
mod tables;

use super::super::format::TableCtx;
use super::super::inline::{FieldValues, Kind};
use super::super::lines::LineEnd;
use super::super::{Chrome, Item, Page, ParaBox, StoryRef};
use super::anchors::PageGeom;
use super::stack::{
    BorderJoin, PendingAnchor, PrevPara, Stack, StackCtx, border_space, decorate, emit_lines,
    para_box, prev_record, rebreak, space_before, stack_story, table_box,
};
use super::{Env, offset_items};
use crate::model::block::{Block, BlockId, BlockKind};
use crate::model::props::{LineSpacing, ParaProps};
use crate::model::section::{HeaderRefs, LineNumberRestart, PageVAlign, Section, SectionStart};
use floats::{OnPage, place_anchors, place_frames};
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
    /// Vertical bands of the page that body text skips (frames that allow
    /// no text beside them).
    bands: Vec<(f32, f32)>,
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
        let grid = self.grid();
        let pb = para_box(
            self.env,
            b,
            &StoryRef::Body,
            width,
            &Default::default(),
            &self.fields(),
            None,
            grid,
        );
        self.boxes.insert(b.id.clone(), Arc::clone(&pb));
        pb
    }

    /// How paragraph `k` (formatted `props`) joins its neighbours' borders.
    fn border_join(
        &self,
        blocks: &[&Block],
        k: usize,
        props: &ParaProps,
        prev: Option<&PrevPara>,
    ) -> BorderJoin {
        let next = blocks
            .get(k + 1)
            .filter(|n| n.kind == BlockKind::Paragraph)
            .map(|n| self.env.formats.paragraph(&n.props, &TableCtx::default()));
        BorderJoin::new(
            props,
            prev.map(|p| &p.border),
            next.as_ref().map(|f| &f.props),
        )
    }

    /// Height a keep-with-next chain starting at `i` needs on one page.
    fn keep_chain(&mut self, blocks: &[&Block], i: usize, width: f32) -> f32 {
        let mut need = 0.0;
        let mut prev: Option<PrevPara> = self.prev.clone();
        let mut k = i;
        while k < blocks.len() {
            let b = blocks[k];
            if b.kind != BlockKind::Paragraph {
                // Keep with the first row of a table.
                let tb = table_box(
                    self.env,
                    &self.env.doc.body,
                    b,
                    width,
                    &StoryRef::Body,
                    &self.fields(),
                );
                need += tb.rows.first().map_or(0.0, |r| r.height);
                break;
            }
            let pb = self.para(b, width);
            let props = &pb.format.props;
            need += if k == i {
                0.0
            } else {
                space_before(props, prev.as_ref(), false, self.sum_spacing())
            };
            let join = self.border_join(blocks, k, props, prev.as_ref());
            let (bt, bb) = border_space(props, join);
            let lines = &pb.lines.lines;
            if let Some(b) = lines
                .iter()
                .position(|l| matches!(l.ends, LineEnd::PageBreak | LineEnd::ColumnBreak))
            {
                // The chain ends at a page break.
                need += bt + lines[..=b].iter().map(|l| l.height).sum::<f32>();
                break;
            }
            if props.keep_next && k + 1 < blocks.len() && k - i < 32 {
                need += bt + pb.lines.height + bb;
                prev = Some(prev_record(props));
                k += 1;
                continue;
            }
            // The last paragraph of the chain: its first lines.
            let take = if props.keep_lines || lines.len() <= 2 || !props.widow_control {
                if props.keep_lines {
                    lines.len()
                } else {
                    lines.len().min(1)
                }
            } else {
                2
            };
            need += bt
                + lines
                    .iter()
                    .take(take.max(1))
                    .map(|l| l.height)
                    .sum::<f32>();
            break;
        }
        need
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

    fn place_paragraph(&mut self, blocks: &[&Block], i: usize) {
        let b = blocks[i];
        let (_, width) = self.col_geom();
        let mut pb = self.para(b, width);
        let props = pb.format.props.clone();
        let at_top = self.cur.as_ref().is_some_and(|c| !c.placed_any);
        if props.page_break_before && !at_top {
            // Not a hard break: the paragraph's space before goes, as at
            // any page top.
            let sect = self.cur.as_ref().map_or(0, |c| c.sect);
            self.start_page(sect, false);
            self.prev = None;
        } else if props.keep_next && !at_top && !hard_break(&pb) {
            // (A paragraph with a page break in it goes on after the break
            // anyway: what comes before it stays.)
            let need = self.keep_chain(blocks, i, width);
            let (y, top) = self.cur.as_ref().map_or((0.0, 0.0), |c| (c.y, c.top));
            let before = space_before(&props, self.prev.as_ref(), false, self.sum_spacing());
            let avail = self.avail_bottom() - y - before;
            let full = self.avail_bottom() - top;
            if need > avail + EPS && need <= full {
                self.next_column(false);
            }
        }
        // The paragraph goes in the column it is now in.
        let (mut col_left, mut width) = (0.0, width);
        let mut li = 0;
        self.follow_column(&mut pb, &mut li, &mut col_left, &mut width);
        let at_top = self.cur.as_ref().is_some_and(|c| !c.placed_any);
        let hard = self.cur.as_ref().is_some_and(|c| c.hard)
            && !self.env.doc.parts().settings.suppress_sp_bf_after_pg_brk;
        let first_in_doc = self.pages.is_empty() && at_top;
        let before = if at_top {
            if hard || first_in_doc || self.env.options.space_before_at_page_top {
                space_before(&props, None, first_in_doc, self.sum_spacing())
            } else {
                0.0
            }
        } else {
            space_before(&props, self.prev.as_ref(), false, self.sum_spacing())
        };
        let gap_top = self.cur.as_ref().map_or(0.0, |c| c.y);
        if let Some(c) = &mut self.cur {
            c.y += before;
        }
        // Where the paragraph's floating drawings are positioned from: its
        // top, above its own space before.
        let own = space_before(&props, None, first_in_doc, self.sum_spacing());
        let mut anchor_top = self.reserve_float_bands(&pb, col_left, width, before.min(own));
        let mut join = self.border_join(blocks, i, &props, self.prev.as_ref());
        let mut lines_len = pb.lines.lines.len();
        let mut first_fragment = true;
        while li < lines_len {
            self.skip_bands();
            self.suppress_top_spacing(&pb, li);
            let (bt, bb) = border_space(&props, join);
            let mut frag_top = self.cur.as_ref().map_or(0.0, |c| c.y);
            if first_fragment {
                if join.prev {
                    // The shared border box spans the gap to the previous paragraph.
                    frag_top = gap_top;
                }
                if let Some(c) = &mut self.cur {
                    c.y += bt;
                }
            }
            let (fit, note_ids) = self.fit_lines(&pb, li);
            let remaining = lines_len - li;
            let mut take = fit.min(remaining);
            if let Some(k) = (li..li + take).find(|&k| {
                matches!(
                    pb.lines.lines[k].ends,
                    LineEnd::PageBreak | LineEnd::ColumnBreak
                )
            }) {
                take = k - li + 1;
            }
            if take < remaining {
                let breaks_inside = (li..li + take).any(|k| {
                    matches!(
                        pb.lines.lines[k].ends,
                        LineEnd::PageBreak | LineEnd::ColumnBreak
                    )
                });
                if !breaks_inside {
                    if props.widow_control {
                        if remaining - take == 1 && take >= 2 {
                            take -= 1;
                        }
                        if li == 0 && take == 1 && remaining >= 2 {
                            take = 0;
                        }
                    }
                    let column = self.avail_bottom() - self.cur.as_ref().map_or(0.0, |c| c.top);
                    if props.keep_lines && li == 0 && pb.lines.height <= column {
                        take = 0;
                    }
                }
            }
            let placed_any = self.cur.as_ref().is_some_and(|c| c.placed_any);
            if take == 0 {
                if placed_any {
                    if first_fragment && let Some(c) = &mut self.cur {
                        c.y -= bt;
                    }
                    let next = pb.lines.lines.get(li).map_or(0.0, |l| l.height);
                    if self.jump_band(next + bt) {
                        continue;
                    }
                    self.next_column(false);
                    self.follow_column(&mut pb, &mut li, &mut col_left, &mut width);
                    lines_len = pb.lines.lines.len();
                    // A new column starts a new border box.
                    join.prev = false;
                    anchor_top = self.reserve_float_bands(&pb, col_left, width, 0.0);
                    continue;
                }
                take = 1;
            }
            // Place lines li..li+take.
            let ids: Vec<i64> = note_ids
                .iter()
                .take_while(|(k, _)| *k < li + take)
                .map(|(_, id)| *id)
                .collect();
            self.add_notes(&ids);
            let y = self.cur.as_ref().map_or(0.0, |c| c.y);
            let mut items = Vec::new();
            let mut anchors: Vec<PendingAnchor> = Vec::new();
            let mut notes = Vec::new();
            let h = emit_lines(
                &pb,
                li,
                li + take,
                col_left,
                y,
                &mut items,
                &mut anchors,
                &mut notes,
                if first_fragment { anchor_top } else { y },
            );
            self.number_lines(&pb, li, li + take, col_left, y);
            let last_fragment = li + take >= lines_len;
            let bottom = y + h + if last_fragment { bb } else { 0.0 };
            if props.shading.is_some() || props.borders.any() {
                let mut deco = Vec::new();
                if !first_fragment {
                    frag_top = y;
                }
                decorate(
                    &props,
                    col_left,
                    frag_top,
                    bottom,
                    first_fragment,
                    last_fragment,
                    width,
                    join,
                    &mut deco,
                );
                if let Some(c) = &mut self.cur {
                    c.body.extend(deco);
                }
            }
            let geom = self.page_geom();
            let fields = self.fields();
            let on_page = OnPage {
                env: self.env,
                fields: &fields,
                geom: &geom,
            };
            if let Some(c) = &mut self.cur {
                c.body.extend(items);
                place_anchors(&on_page, &anchors, &mut c.behind, &mut c.front);
                c.y = bottom;
                c.placed_any = true;
                c.hard = false;
            }
            li += take;
            first_fragment = false;
            let last_end = pb.lines.lines[li - 1].ends;
            if li < lines_len || matches!(last_end, LineEnd::PageBreak | LineEnd::ColumnBreak) {
                match last_end {
                    LineEnd::PageBreak => {
                        let sect = self.cur.as_ref().map_or(0, |c| c.sect);
                        self.start_page(sect, true);
                        if pb.lines.lines[..li].iter().all(|l| l.height == 0.0) {
                            // A paragraph that starts with a page break
                            // starts after it, with its space before.
                            self.space_after_hard_break(&props);
                        }
                    }
                    LineEnd::ColumnBreak => self.next_column(true),
                    _ => {
                        // Lines continue below a band that stopped them.
                        let next = pb.lines.lines.get(li).map_or(0.0, |l| l.height);
                        if !self.jump_band(next) {
                            self.next_column(false);
                        }
                    }
                }
                self.follow_column(&mut pb, &mut li, &mut col_left, &mut width);
                lines_len = pb.lines.lines.len();
            }
        }
        self.prev = Some(prev_record(&props));
    }

    /// Takes the current column's left edge and width for a paragraph
    /// whose lines from `li` on are still to be placed, breaking those
    /// lines again when the column is not as wide as they were broken for.
    fn follow_column(
        &mut self,
        pb: &mut Arc<ParaBox>,
        li: &mut usize,
        col_left: &mut f32,
        width: &mut f32,
    ) {
        let (left, w) = self.col_geom();
        *col_left = left;
        if (w - *width).abs() <= COLUMN_SLACK {
            return;
        }
        *width = w;
        if let Some(line) = pb.lines.lines.get(*li) {
            *pb = rebreak(self.env, pb, w, line.start, self.grid());
            *li = 0;
        }
    }

    /// Whether `blocks[i]` is an empty paragraph that only ends a section of
    /// several columns and takes no room: before a section going on on the
    /// same page (the columns end with the text), or when it would start a
    /// page of its own.
    fn bare_section_end(&mut self, blocks: &[&Block], i: usize, section_of: &[usize]) -> bool {
        let (Some(&s), Some(&next)) = (section_of.get(i), section_of.get(i + 1)) else {
            return false;
        };
        if s == next || self.sections.get(s).is_none_or(|c| c.columns.len() < 2) {
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
        continuous || y + pb.lines.height > self.avail_bottom() + EPS
    }

    /// Adds the space before of a paragraph that started with a page break
    /// at the top of the page the break started, unless the document
    /// suppresses it there. (Word leaves it out for exactly spaced lines.)
    fn space_after_hard_break(&mut self, props: &ParaProps) {
        if self.env.doc.parts().settings.suppress_sp_bf_after_pg_brk
            || matches!(props.line, LineSpacing::Exact(_))
        {
            return;
        }
        let before = space_before(props, None, false, self.sum_spacing());
        if let Some(c) = &mut self.cur {
            c.y += before;
        }
    }

    /// Lifts the page's first line when the document suppresses extra line
    /// spacing at the top of the page: an at-least line there is no taller
    /// than its text's size (`w:suppressTopSpacing`).
    fn suppress_top_spacing(&mut self, pb: &ParaBox, li: usize) {
        if !self.env.doc.parts().settings.suppress_top_spacing {
            return;
        }
        let LineSpacing::AtLeast(min) = pb.format.props.line else {
            return;
        };
        let Some(line) = pb.lines.lines.get(li) else {
            return;
        };
        let size = pb.inline.clusters[line.start..line.end]
            .iter()
            .map(|c| c.size)
            .fold(0.0f32, f32::max);
        if let Some(c) = &mut self.cur
            && !c.placed_any
            && c.col == 0
            && (c.y - c.top).abs() < EPS
            && size > 0.0
        {
            c.y -= (min - size).max(0.0);
        }
    }

    /// The pitch lines snap to in the current section, if they do.
    fn grid(&self) -> Option<f32> {
        let s = self.section();
        (s.grid.snap_lines && s.grid.line_pitch > 0.0).then_some(s.grid.line_pitch)
    }

    /// How many lines from `li` fit in the current column, and the note
    /// references (line index, id) of the lines considered.
    fn fit_lines(&mut self, pb: &ParaBox, li: usize) -> (usize, Vec<(usize, i64)>) {
        let lines = &pb.lines.lines;
        let mut y = self.cur.as_ref().map_or(0.0, |c| c.y);
        let bottom = self.avail_bottom();
        // The extra room of multiple line spacing sits below the text and may
        // run into the bottom margin: a line fits when its text does.
        let props = &pb.format.props;
        let spread = match props.line {
            LineSpacing::Auto(m) if m > 1.0 && !(props.snap_to_grid && self.grid().is_some()) => m,
            _ => 1.0,
        };
        let mut extra = 0.0;
        let mut count = 0;
        let mut ids: Vec<(usize, i64)> = Vec::new();
        for (k, line) in lines.iter().enumerate().skip(li) {
            let line_notes: Vec<i64> = pb
                .inline
                .notes
                .iter()
                .filter(|(at, endnote, _)| !endnote && *at >= line.start && *at < line.end)
                .map(|(_, _, id)| *id)
                .collect();
            let mut pending: Vec<i64> = ids.iter().map(|(_, id)| *id).collect();
            pending.extend(&line_notes);
            let note_h = self.notes_needed(&pending);
            if y + line.height / spread > bottom - note_h + EPS {
                break;
            }
            y += line.height;
            extra = note_h;
            count += 1;
            ids.extend(line_notes.into_iter().map(|id| (k, id)));
        }
        let _ = extra;
        (count, ids)
    }

    fn number_lines(&mut self, pb: &ParaBox, from: usize, to: usize, col_left: f32, y: f32) {
        let s = self.section().clone();
        let Some(ln) = s.line_numbers else {
            return;
        };
        if pb.format.props.suppress_line_numbers {
            return;
        }
        let Some(cur) = &mut self.cur else {
            return;
        };
        if ln.restart == LineNumberRestart::NewPage && cur.line_on_page == 0 && self.line_no > 0 {
            self.line_no = 0;
        }
        let base = pb.lines.lines.get(from).map_or(0.0, |l| l.top);
        for line in &pb.lines.lines[from..to] {
            self.line_no += 1;
            cur.line_on_page += 1;
            let n = ln.start - 1 + self.line_no;
            if ln.count_by > 0 && n % ln.count_by == 0 {
                let mark = &pb.format.mark;
                cur.body.push(Item::LineNumber {
                    text: n.to_string(),
                    right: col_left - ln.distance.unwrap_or(LINE_NUMBER_DISTANCE),
                    baseline: y + line.top - base + line.baseline,
                    size: mark.size,
                    font: mark.ascii.clone(),
                });
            }
        }
    }

    pub fn finish(mut self) -> Vec<Page> {
        self.finish_page();
        self.pages
    }
}

/// Whether a page or column break ends one of the paragraph's lines.
fn hard_break(pb: &ParaBox) -> bool {
    pb.lines
        .lines
        .iter()
        .any(|l| matches!(l.ends, LineEnd::PageBreak | LineEnd::ColumnBreak))
}
