//! The body paginator: sections, columns, pages, keep rules, notes.

use super::super::inline::FieldValues;
use super::super::lines::LineEnd;
use super::super::{Item, Page, ParaBox, StoryRef};
use super::anchors::{PageGeom, resolve};
use super::stack::{
    PendingAnchor, PrevPara, Stack, StackCtx, border_space, decorate, emit_lines, emit_row,
    para_box, placed, prev_record, space_before, stack_story, table_box,
};
use super::{Env, offset_items};
use crate::model::block::{Block, BlockId, BlockKind};
use crate::model::section::{HeaderRefs, LineNumberRestart, PageVAlign, Section, SectionStart};
use pptx_engine::path::Rect;
use std::collections::HashMap;
use std::sync::Arc;

const EPS: f32 = 0.01;

/// Default distance of line numbers from the text.
const LINE_NUMBER_DISTANCE: f32 = 18.0;

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
        let header = self.hf_stack(pick(&headers).as_ref(), &s, &fields);
        let footer = self.hf_stack(pick(&footers).as_ref(), &s, &fields);
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
        if let Some(mut h) = header {
            offset_items(&mut h.items, s.left + s.gutter, s.header);
            for a in &mut h.anchors {
                a.para_top += s.header;
                a.line_top += s.header;
                a.char_x += s.left;
            }
            if !s.top_exact {
                top = top.max(s.header + h.height);
            }
            chrome.extend(h.items);
            place_anchors(&h.anchors, &geom, &mut behind, &mut front);
        }
        if let Some(mut f) = footer {
            let y = s.page_h - s.footer - f.height;
            offset_items(&mut f.items, s.left + s.gutter, y);
            for a in &mut f.anchors {
                a.para_top += y;
                a.line_top += y;
                a.char_x += s.left;
            }
            if !s.bottom_exact {
                bottom = bottom.min(y);
            }
            chrome.extend(f.items);
            place_anchors(&f.anchors, &geom, &mut behind, &mut front);
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

    fn separator_stack(&mut self) -> Option<Stack> {
        if self.separator.is_none() {
            let notes = self.env.doc.footnotes();
            let sep = notes.by_id.values().find(|n| n.kind == "separator");
            let width = self.section().text_width();
            self.separator = Some(match sep {
                Some(n) => stack_story(
                    self.env,
                    &n.story,
                    None,
                    &StackCtx {
                        story: StoryRef::Footnote(-1),
                        width,
                        table: Default::default(),
                        fields: self.fields(),
                        note_number: None,
                    },
                ),
                None => Stack {
                    items: vec![Item::Rule {
                        x0: 0.0,
                        y0: 6.0,
                        x1: 144.0,
                        y1: 6.0,
                        border: crate::model::props::Border {
                            style: crate::model::props::LineStyle::Single,
                            width: 0.5,
                            space: 0.0,
                            color: crate::model::props::ColorRef::Auto,
                        },
                    }],
                    anchors: Vec::new(),
                    height: 12.0,
                    notes: Vec::new(),
                },
            });
        }
        self.separator.clone()
    }

    fn note_height(&mut self, id: i64) -> f32 {
        if let Some(st) = self.note_stacks.get(&id) {
            return st.height;
        }
        let Some(note) = self.env.doc.footnotes().by_id.get(&id) else {
            return 0.0;
        };
        let number = self
            .env
            .note_numbers
            .get(&(false, id))
            .cloned()
            .unwrap_or_default();
        let st = stack_story(
            self.env,
            &note.story,
            None,
            &StackCtx {
                story: StoryRef::Footnote(id),
                width: self.section().text_width(),
                table: Default::default(),
                fields: self.fields(),
                note_number: Some(number),
            },
        );
        let h = st.height;
        self.note_stacks.insert(id, st);
        h
    }

    /// Extra note height needed for these note references on this page.
    fn notes_needed(&mut self, ids: &[i64]) -> f32 {
        let fresh: Vec<i64> = {
            let cur = self.cur.as_ref();
            ids.iter()
                .copied()
                .filter(|id| cur.is_none_or(|c| !c.notes.contains(id)))
                .collect()
        };
        if fresh.is_empty() {
            return 0.0;
        }
        let mut h: f32 = fresh.iter().map(|&id| self.note_height(id)).sum();
        if self.cur.as_ref().is_some_and(|c| c.notes.is_empty()) {
            h += self.separator_stack().map_or(0.0, |s| s.height);
        }
        h
    }

    fn add_notes(&mut self, ids: &[i64]) {
        let need = self.notes_needed(ids);
        if let Some(cur) = &mut self.cur {
            for id in ids {
                if !cur.notes.contains(id) {
                    cur.notes.push(*id);
                }
            }
            cur.notes_height += need;
        }
    }

    /// Moves to the next column, or the next page after the last column.
    fn next_column(&mut self, hard: bool) {
        let (sect, col, cols) = match &self.cur {
            Some(c) => (c.sect, c.col, self.sections[c.sect].columns.len()),
            None => return,
        };
        if col + 1 < cols {
            if let Some(c) = &mut self.cur {
                c.col += 1;
                c.y = c.top;
                c.placed_any = false;
                c.hard = hard;
            }
        } else {
            self.start_page(sect, hard);
        }
        self.prev = None;
    }

    fn avail_bottom(&self) -> f32 {
        self.cur.as_ref().map_or(0.0, |c| c.bottom - c.notes_height)
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
        let grid = {
            let s = self.section();
            (s.grid.snap_lines && s.grid.line_pitch > 0.0).then_some(s.grid.line_pitch)
        };
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

    /// Height a keep-with-next chain starting at `i` needs on one page.
    fn keep_chain(&mut self, blocks: &[&Block], i: usize, width: f32) -> f32 {
        let mut need = 0.0;
        let mut prev: Option<PrevPara> = None;
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
            let (bt, bb) = border_space(props);
            let lines = &pb.lines.lines;
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
        for (i, b) in blocks.iter().enumerate() {
            let s = section_of[i].min(self.sections.len() - 1);
            if self.cur.is_none() {
                self.start_page(s, false);
                cur_section = s;
            } else if s != cur_section {
                cur_section = s;
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
                                c.sect = s;
                                c.col = 0;
                            }
                        } else {
                            self.start_page(s, true);
                        }
                    }
                    SectionStart::NextColumn => {
                        if let Some(c) = &mut self.cur {
                            c.sect = s;
                        }
                        self.section_started[s] = true;
                        self.next_column(true);
                    }
                    _ => self.start_page(s, true),
                }
            }
            match b.kind {
                BlockKind::Paragraph => self.place_paragraph(blocks, i),
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
        let (col_left, width) = self.col_geom();
        let pb = self.para(b, width);
        let props = pb.format.props.clone();
        let at_top = self.cur.as_ref().is_some_and(|c| !c.placed_any);
        if props.page_break_before && !at_top {
            let sect = self.cur.as_ref().map_or(0, |c| c.sect);
            self.start_page(sect, true);
            self.prev = None;
        } else if props.keep_next && !at_top {
            let need = self.keep_chain(blocks, i, width);
            let (y, top) = self.cur.as_ref().map_or((0.0, 0.0), |c| (c.y, c.top));
            let before = space_before(&props, self.prev.as_ref(), false, self.sum_spacing());
            let avail = self.avail_bottom() - y - before;
            let full = self.avail_bottom() - top;
            if need > avail + EPS && need <= full {
                self.next_column(false);
            }
        }
        let at_top = self.cur.as_ref().is_some_and(|c| !c.placed_any);
        let hard = self.cur.as_ref().is_some_and(|c| c.hard);
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
        if let Some(c) = &mut self.cur {
            c.y += before;
        }
        let (bt, bb) = border_space(&props);
        let lines_len = pb.lines.lines.len();
        let mut li = 0;
        let mut first_fragment = true;
        while li < lines_len {
            let mut frag_top = self.cur.as_ref().map_or(0.0, |c| c.y);
            if first_fragment {
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
                    self.next_column(false);
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
                y,
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
                    &mut deco,
                );
                if let Some(c) = &mut self.cur {
                    c.body.extend(deco);
                }
            }
            let geom = self.page_geom();
            if let Some(c) = &mut self.cur {
                c.body.extend(items);
                place_anchors(&anchors, &geom, &mut c.behind, &mut c.front);
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
                    }
                    LineEnd::ColumnBreak => self.next_column(true),
                    _ => self.next_column(false),
                }
            }
        }
        self.prev = Some(prev_record(&props));
    }

    /// How many lines from `li` fit in the current column, and the note
    /// references (line index, id) of the lines considered.
    fn fit_lines(&mut self, pb: &ParaBox, li: usize) -> (usize, Vec<(usize, i64)>) {
        let lines = &pb.lines.lines;
        let mut y = self.cur.as_ref().map_or(0.0, |c| c.y);
        let bottom = self.avail_bottom();
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
            if y + line.height > bottom - note_h + EPS {
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

    fn place_table(&mut self, b: &Block) {
        let (col_left, width) = self.col_geom();
        if let (Some(prev), Some(c)) = (self.prev.take(), &mut self.cur)
            && c.placed_any
        {
            c.y += prev.after;
        }
        let tb = table_box(
            self.env,
            &self.env.doc.body,
            b,
            width,
            &StoryRef::Body,
            &self.fields(),
        );
        let headers: Vec<usize> = (0..tb.rows.len())
            .take_while(|&r| tb.rows[r].header)
            .collect();
        let mut r = 0;
        while r < tb.rows.len() {
            let h = tb.rows[r].height;
            let (y, placed_any) = self
                .cur
                .as_ref()
                .map_or((0.0, false), |c| (c.y, c.placed_any));
            if y + h > self.avail_bottom() + EPS && placed_any {
                self.next_column(false);
                // Repeat header rows at the top of the new page.
                if r >= headers.len() && !headers.is_empty() {
                    for &hr in &headers {
                        self.emit_table_row(&tb, hr, col_left);
                    }
                }
                continue;
            }
            self.emit_table_row(&tb, r, col_left);
            r += 1;
        }
        self.prev = None;
    }

    fn emit_table_row(&mut self, tb: &super::stack::TableBox, r: usize, col_left: f32) {
        let y = self.cur.as_ref().map_or(0.0, |c| c.y);
        let mut items = Vec::new();
        let mut anchors = Vec::new();
        let mut notes: Vec<(bool, i64)> = Vec::new();
        emit_row(tb, r, col_left, y, &mut items, &mut anchors, &mut notes);
        let ids: Vec<i64> = notes
            .iter()
            .filter(|(e, _)| !e)
            .map(|(_, id)| *id)
            .collect();
        self.add_notes(&ids);
        let geom = self.page_geom();
        if let Some(c) = &mut self.cur {
            c.body.extend(items);
            place_anchors(&anchors, &geom, &mut c.behind, &mut c.front);
            c.y += tb.rows[r].height;
            c.placed_any = true;
            c.hard = false;
        }
    }

    fn place_endnotes(&mut self) {
        let notes = self.env.doc.endnotes();
        let mut ordered: Vec<(&String, i64)> = self
            .env
            .note_numbers
            .iter()
            .filter(|((endnote, _), _)| *endnote)
            .map(|((_, id), n)| (n, *id))
            .collect();
        if ordered.is_empty() {
            return;
        }
        ordered.sort_by_key(|(_, id)| *id);
        let width = self.section().text_width();
        let (col_left, _) = self.col_geom();
        for (number, id) in ordered {
            let Some(note) = notes.by_id.get(&id) else {
                continue;
            };
            let st = stack_story(
                self.env,
                &note.story,
                None,
                &StackCtx {
                    story: StoryRef::Endnote(id),
                    width,
                    table: Default::default(),
                    fields: self.fields(),
                    note_number: Some(number.clone()),
                },
            );
            let (y, placed_any) = self
                .cur
                .as_ref()
                .map_or((0.0, false), |c| (c.y, c.placed_any));
            if y + st.height > self.avail_bottom() && placed_any {
                self.next_column(false);
            }
            let y = self.cur.as_ref().map_or(0.0, |c| c.y);
            let mut items = st.items.clone();
            offset_items(&mut items, col_left, y);
            if let Some(c) = &mut self.cur {
                c.body.extend(items);
                c.y += st.height;
                c.placed_any = true;
            }
        }
    }

    pub fn finish(mut self) -> Vec<Page> {
        self.finish_page();
        self.pages
    }
}

/// Places floating drawings behind or in front of the text.
fn place_anchors(
    anchors: &[PendingAnchor],
    geom: &PageGeom,
    behind: &mut Vec<Item>,
    front: &mut Vec<Item>,
) {
    let mut sorted: Vec<&PendingAnchor> = anchors.iter().collect();
    sorted.sort_by_key(|a| a.drawing.anchor.as_ref().map_or(0, |x| x.z));
    for a in sorted {
        let Some(rect) = resolve(a, geom) else {
            continue;
        };
        let item = placed(Arc::clone(&a.drawing), rect, a.story.clone());
        if a.drawing.anchor.as_ref().is_some_and(|x| x.behind) {
            behind.push(item);
        } else {
            front.push(item);
        }
    }
}
