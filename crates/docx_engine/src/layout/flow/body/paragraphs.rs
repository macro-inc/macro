//! Paragraphs in the body: placing their lines on pages and in columns,
//! with keep-with-next chains, widow control, notes and line numbers.

use super::super::super::format::TableCtx;
use super::super::super::lines::LineEnd;
use super::super::super::{Item, ParaBox, StoryRef};
use super::super::stack::{
    BorderJoin, Fragment, PendingAnchor, PrevPara, Sink, border_space, decorate, emit_lines,
    prev_record, rebreak, space_after, space_before, table_box,
};
use super::floats::{OnPage, place_anchors};
use super::{COLUMN_SLACK, EPS, Flow, LINE_NUMBER_DISTANCE};
use crate::model::block::{Block, BlockKind};
use crate::model::props::{LineSpacing, ParaProps};
use crate::model::section::LineNumberRestart;
use std::sync::Arc;

/// A paragraph on its way onto the pages: its lines, broken for the
/// column it is in, the first of them still to place, and that column.
pub(super) struct Placing {
    /// The paragraph's lines.
    pub(super) pb: Arc<ParaBox>,
    /// The first line still to place.
    pub(super) li: usize,
    /// The column's left edge (page x).
    pub(super) col_left: f32,
    /// The column's width.
    pub(super) width: f32,
}

impl Flow<'_, '_> {
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

    pub(super) fn place_paragraph(&mut self, blocks: &[&Block], i: usize) {
        let b = blocks[i];
        let (_, width) = self.col_geom();
        let pb = self.para(b, width);
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
        let mut p = Placing {
            pb,
            li: 0,
            col_left: 0.0,
            width,
        };
        self.follow_column(&mut p);
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
        let mut anchor_top = self.reserve_float_bands(&mut p, before.min(own));
        let mut join = self.border_join(blocks, i, &props, self.prev.as_ref());
        let mut first_fragment = true;
        while p.li < p.pb.lines.lines.len() {
            let (li, lines_len) = (p.li, p.pb.lines.lines.len());
            self.skip_bands();
            self.suppress_top_spacing(&p.pb, li);
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
            let (fit, note_ids) = self.fit_lines(&p.pb, li);
            let lines = &p.pb.lines.lines;
            let remaining = lines_len - li;
            let mut take = fit.min(remaining);
            if let Some(k) = (li..li + take)
                .find(|&k| matches!(lines[k].ends, LineEnd::PageBreak | LineEnd::ColumnBreak))
            {
                take = k - li + 1;
            }
            if take < remaining {
                let breaks_inside = (li..li + take)
                    .any(|k| matches!(lines[k].ends, LineEnd::PageBreak | LineEnd::ColumnBreak));
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
                    if props.keep_lines && li == 0 && p.pb.lines.height <= column {
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
                    let next = p.pb.lines.lines.get(li).map_or(0.0, |l| l.height);
                    if self.jump_band(next + bt) {
                        continue;
                    }
                    self.next_column(false);
                    self.follow_column(&mut p);
                    // A new column starts a new border box.
                    join.prev = false;
                    anchor_top = self.reserve_float_bands(&mut p, 0.0);
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
            let sink = Sink {
                items: &mut items,
                anchors: &mut anchors,
                notes: &mut notes,
            };
            let h = emit_lines(&p.pb, (li, li + take), (p.col_left, y), anchor_top, sink);
            self.number_lines(&p.pb, li, li + take, p.col_left, y);
            let last_fragment = li + take >= lines_len;
            let bottom = y + h + if last_fragment { bb } else { 0.0 };
            if props.shading.is_some() || props.borders.any() {
                let mut deco = Vec::new();
                if !first_fragment {
                    frag_top = y;
                }
                let frag = Fragment {
                    x: p.col_left,
                    width: p.width,
                    top: frag_top,
                    bottom,
                    first: first_fragment,
                    last: last_fragment,
                };
                decorate(&props, frag, join, &mut deco);
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
            p.li += take;
            first_fragment = false;
            let last_end = p.pb.lines.lines[p.li - 1].ends;
            if p.li < lines_len || matches!(last_end, LineEnd::PageBreak | LineEnd::ColumnBreak) {
                match last_end {
                    LineEnd::PageBreak => {
                        let sect = self.cur.as_ref().map_or(0, |c| c.sect);
                        self.start_page(sect, true);
                        if p.pb.lines.lines[..p.li].iter().all(|l| l.height == 0.0) {
                            // A paragraph that starts with a page break
                            // starts after it, with its space before.
                            self.space_after_hard_break(&props);
                        }
                    }
                    LineEnd::ColumnBreak => self.next_column(true),
                    _ => {
                        // Lines continue below a band that stopped them,
                        // where their drawings' bands are already reserved.
                        let next = p.pb.lines.lines.get(p.li).map_or(0.0, |l| l.height);
                        if self.jump_band(next) {
                            continue;
                        }
                        self.next_column(false);
                    }
                }
                self.follow_column(&mut p);
                // The drawings of the lines still to place go with them,
                // positioned from where they go on.
                anchor_top = self.reserve_float_bands(&mut p, 0.0);
            }
        }
        self.prev = Some(prev_record(&props));
    }

    /// Takes the current column's left edge and width for a paragraph
    /// whose lines from `p.li` on are still to be placed, breaking those
    /// lines again when the column is not as wide as they were broken for.
    pub(super) fn follow_column(&mut self, p: &mut Placing) {
        let (left, w) = self.col_geom();
        p.col_left = left;
        if (w - p.width).abs() <= COLUMN_SLACK {
            return;
        }
        p.width = w;
        if let Some(line) = p.pb.lines.lines.get(p.li) {
            p.pb = rebreak(self.env, &p.pb, w, line.start, self.grid());
            p.li = 0;
        }
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
            // Above footnotes, a paragraph's space after must fit as well.
            let notes =
                !pending.is_empty() || self.cur.as_ref().is_some_and(|c| !c.notes.is_empty());
            let after = if notes && k + 1 == lines.len() {
                space_after(props)
            } else {
                0.0
            };
            if y + line.height / spread + after > bottom - note_h + EPS {
                break;
            }
            y += line.height;
            count += 1;
            ids.extend(line_notes.into_iter().map(|id| (k, id)));
        }
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
            if ln.count_by > 0 && n.is_multiple_of(ln.count_by) {
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
}

/// Whether a page or column break ends one of the paragraph's lines.
fn hard_break(pb: &ParaBox) -> bool {
    pb.lines
        .lines
        .iter()
        .any(|l| matches!(l.ends, LineEnd::PageBreak | LineEnd::ColumnBreak))
}
