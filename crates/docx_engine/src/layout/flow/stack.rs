//! Laying blocks out one after another without page breaks: table cells,
//! headers, footers, notes and text boxes.

use super::super::format::{ParaFormat, TableCtx};
use super::super::inline::{self, FieldValues, InlineCtx, Kind};
use super::super::lines::{LineCtx, break_lines};
use super::super::table::{CellGeom, TableGeom, geometry};
use super::super::{Item, ParaBox, PlacedDrawing, PlacedLine, StoryRef};
use super::Env;
use super::frames::{FrameWrap, PendingFrame, emit_frame, frame_box, place_in_container};
use crate::model::block::{Block, BlockId, BlockKind, Story};
use crate::model::props::{Border, HeightRule, LineSpacing, ParaBorders, ParaProps, VMerge};
use pptx_engine::path::Rect;
use std::sync::Arc;

/// A floating drawing whose position depends on the page it lands on.
#[derive(Clone, Debug)]
pub struct PendingAnchor {
    /// The drawing.
    pub drawing: Arc<super::super::drawing::Drawing>,
    /// The anchoring paragraph's top (stack coordinates).
    pub para_top: f32,
    /// The anchoring line's top.
    pub line_top: f32,
    /// X of the anchor character from the text area left.
    pub char_x: f32,
    /// Story of the anchoring paragraph.
    pub story: StoryRef,
}

/// Blocks laid out top to bottom.
#[derive(Clone, Debug, Default)]
pub struct Stack {
    /// Items, relative to the stack's top-left (the text area's left edge).
    pub items: Vec<Item>,
    /// Floating drawings to place once the page is known.
    pub anchors: Vec<PendingAnchor>,
    /// Height.
    pub height: f32,
    /// Notes referenced inside.
    pub notes: Vec<(bool, i64)>,
    /// Text frames to place once the page is known.
    pub frames: Vec<PendingFrame>,
}

/// What a stack is laid out in.
pub struct StackCtx {
    /// The story.
    pub story: StoryRef,
    /// Text area width.
    pub width: f32,
    /// Table formatting context of the paragraphs.
    pub table: TableCtx,
    /// Page-dependent field values.
    pub fields: FieldValues,
    /// The note being laid out, for its own number.
    pub note_number: Option<String>,
    /// Leave text frames for the page to place (headers and footers);
    /// otherwise they are placed inside the stack.
    pub float_frames: bool,
}

/// The previous paragraph, for spacing between paragraphs.
#[derive(Clone, Debug, Default)]
pub struct PrevPara {
    /// Its style.
    pub style: Option<String>,
    /// Its space after.
    pub after: f32,
    /// It uses contextual spacing.
    pub contextual: bool,
    /// Its space after is automatic.
    pub auto_after: bool,
    /// It is a list item.
    pub numbered: bool,
    /// Its borders and indents, for border groups.
    pub border: BorderBox,
}

/// What decides whether consecutive paragraphs share one border box.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BorderBox {
    /// Borders.
    pub borders: ParaBorders,
    /// Left and right indents.
    pub indents: (f32, f32),
}

impl BorderBox {
    /// A paragraph's border frame.
    pub fn of(props: &ParaProps) -> Self {
        Self {
            borders: props.borders,
            indents: (props.ind_left, props.ind_right),
        }
    }
}

/// How a paragraph joins the border box of its neighbours: Word draws
/// consecutive paragraphs with the same borders as one box, with the
/// `between` border (if any) instead of a bottom and top border inside it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BorderJoin {
    /// The previous paragraph is in the same box.
    pub prev: bool,
    /// The next paragraph is in the same box.
    pub next: bool,
}

impl BorderJoin {
    /// The join of a paragraph between `prev` and `next` (their formats).
    pub fn new(props: &ParaProps, prev: Option<&BorderBox>, next: Option<&ParaProps>) -> Self {
        let own = BorderBox::of(props);
        let shares = |o: &BorderBox| own.borders.any() && *o == own;
        Self {
            prev: prev.is_some_and(shares),
            next: next.is_some_and(|n| shares(&BorderBox::of(n))),
        }
    }
}

/// Space before a paragraph (points), given the one before it. Word 2007
/// and later separate paragraphs by the larger of the first's space after
/// and the second's space before; with `doNotUseHTMLParagraphAutoSpacing`
/// (`sum`) they add up, as in Word 2003.
pub fn space_before(
    props: &ParaProps,
    prev: Option<&PrevPara>,
    first_in_container: bool,
    sum: bool,
) -> f32 {
    let mut before = if props.before_auto {
        if first_in_container { 0.0 } else { 14.0 }
    } else {
        match props.before_lines {
            Some(l) if l > 0.0 => l * 12.0,
            _ => props.before,
        }
    };
    let Some(prev) = prev else {
        return before.max(0.0);
    };
    let same_style = prev.style == props.style;
    if props.contextual_spacing && same_style {
        before = 0.0;
    }
    let mut after = prev.after;
    if prev.contextual && same_style {
        after = 0.0;
    }
    if props.before_auto && prev.auto_after && prev.numbered && props.num.is_some() {
        // HTML-style auto spacing gives list items none.
        return 0.0;
    }
    if sum {
        (after + before).max(0.0)
    } else {
        after.max(before).max(0.0)
    }
}

/// Space after a paragraph (points).
pub fn space_after(props: &ParaProps) -> f32 {
    if props.after_auto {
        14.0
    } else {
        match props.after_lines {
            Some(l) if l > 0.0 => l * 12.0,
            _ => props.after,
        }
        .max(0.0)
    }
}

/// The record a paragraph leaves for the next one's spacing.
pub fn prev_record(props: &ParaProps) -> PrevPara {
    PrevPara {
        style: props.style.clone(),
        after: space_after(props),
        contextual: props.contextual_spacing,
        auto_after: props.after_auto,
        numbered: props.num.is_some(),
        border: BorderBox::of(props),
    }
}

/// Lays out one paragraph into a box.
pub(in crate::layout) fn para_box(
    env: &Env<'_>,
    block: &Block,
    story: &StoryRef,
    width: f32,
    table: &TableCtx,
    fields: &FieldValues,
    note_number: Option<&str>,
    grid: Option<f32>,
) -> Arc<ParaBox> {
    // Body labels are numbered across the document; other stories (whose
    // block ids may repeat the body's) number their paragraphs themselves.
    let own_label = (*story != StoryRef::Body)
        .then(|| env.story_label(block, table))
        .flatten();
    let label = if *story == StoryRef::Body {
        env.labels.get(&block.id).map(|(l, p)| (l, p))
    } else {
        own_label.as_ref().map(|(l, p)| (l, p))
    };
    let key = env.cache.map(|_| {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        table.hash(&mut h);
        crate::layout::ParaKey {
            version: block.version,
            generation: env.doc.generation,
            width: width.to_bits(),
            table: h.finish(),
            label: label.map(|(l, _)| (l.text.clone(), format!("{:?}{:?}", l.suffix, l.jc))),
            grid: grid.map_or(0, f32::to_bits),
            markup: env.options.markup,
            note_number: note_number.map(str::to_owned),
        }
    });
    if let (Some(cache), Some(key)) = (env.cache, key.as_ref())
        && let Some(pb) = cache.get(story, &block.id, key)
    {
        return pb;
    }
    let format: Arc<ParaFormat> = env.formats.paragraph(&block.props, table);
    let ctx = InlineCtx {
        formats: &env.formats,
        fonts: &env.fonts,
        fields,
        note_numbers: &env.note_numbers,
        note_number,
        markup: env.options.markup,
    };
    let built = inline::build(block, &format, label, &ctx);
    let props = &format.props;
    let grid = grid.filter(|_| props.snap_to_grid);
    let lines = break_lines(
        &built,
        &LineCtx {
            props,
            width,
            default_tab: env.doc.parts().settings.default_tab,
            no_expand_shift_return: env.doc.parts().settings.do_not_expand_shift_return,
            grid,
            shrink_spaces: env.doc.parts().settings.compat_mode >= 15,
        },
        None,
    );
    let pb = Arc::new(ParaBox {
        story: story.clone(),
        block: block.id.clone(),
        inline: built,
        lines,
        format,
    });
    // Page fields and note numbers change with what comes before.
    if let (Some(cache), Some(key)) = (env.cache, key)
        && !pb.inline.dynamic
        && pb.inline.notes.is_empty()
    {
        cache.put(story, &block.id, key, Arc::clone(&pb));
    }
    pb
}

/// Border spacing a paragraph adds above and below its lines.
pub fn border_space(props: &ParaProps, join: BorderJoin) -> (f32, f32) {
    let space =
        |b: Option<crate::model::props::Border>| b.map_or(0.0, |b| b.space + b.total_width());
    let top = if join.prev {
        space(props.borders.between)
    } else {
        space(props.borders.top)
    };
    let bottom = if join.next {
        0.0
    } else {
        space(props.borders.bottom)
    };
    (top, bottom)
}

/// Shading and borders around a paragraph fragment spanning `top..bottom`.
pub fn decorate(
    props: &ParaProps,
    x: f32,
    top: f32,
    bottom: f32,
    first: bool,
    last: bool,
    width: f32,
    join: BorderJoin,
    out: &mut Vec<Item>,
) {
    let left = x + props
        .ind_left
        .min(props.ind_left + props.ind_first.min(0.0));
    let right = x + width - props.ind_right;
    let pad_l = props
        .borders
        .left
        .map_or(0.0, |b| b.space + b.total_width());
    let pad_r = props
        .borders
        .right
        .map_or(0.0, |b| b.space + b.total_width());
    if let Some(color) = props.shading {
        out.push(Item::Fill {
            rect: Rect::from_xywh(
                left - pad_l,
                top,
                (right + pad_r) - (left - pad_l),
                bottom - top,
            ),
            color,
        });
    }
    let b = &props.borders;
    let top_border = if join.prev { b.between } else { b.top };
    if first && let Some(t) = top_border {
        out.push(Item::Rule {
            x0: left - pad_l,
            y0: top + t.total_width() / 2.0,
            x1: right + pad_r,
            y1: top + t.total_width() / 2.0,
            border: t,
        });
    }
    if last
        && !join.next
        && let Some(bt) = b.bottom
    {
        out.push(Item::Rule {
            x0: left - pad_l,
            y0: bottom - bt.total_width() / 2.0,
            x1: right + pad_r,
            y1: bottom - bt.total_width() / 2.0,
            border: bt,
        });
    }
    if let Some(l) = b.left {
        out.push(Item::Rule {
            x0: left - l.space - l.total_width() / 2.0,
            y0: top,
            x1: left - l.space - l.total_width() / 2.0,
            y1: bottom,
            border: l,
        });
    }
    if let Some(r) = b.right {
        out.push(Item::Rule {
            x0: right + r.space + r.total_width() / 2.0,
            y0: top,
            x1: right + r.space + r.total_width() / 2.0,
            y1: bottom,
            border: r,
        });
    }
}

/// Emits a paragraph's lines (`first..last`) at (x, y); returns the height used.
pub(super) fn emit_lines(
    pb: &Arc<ParaBox>,
    first: usize,
    last: usize,
    x: f32,
    y: f32,
    out: &mut Vec<Item>,
    anchors: &mut Vec<PendingAnchor>,
    notes: &mut Vec<(bool, i64)>,
    para_top: f32,
) -> f32 {
    let lines = &pb.lines.lines;
    let base = lines.get(first).map_or(0.0, |l| l.top);
    for (i, line) in lines.iter().enumerate().take(last).skip(first) {
        let top = y + line.top - base;
        out.push(Item::Line(PlacedLine {
            para: Arc::clone(pb),
            line: i,
            x,
            y: top,
            clip: None,
        }));
        for c in line.start..line.end {
            let cl = &pb.inline.clusters[c];
            if let Kind::Anchor(o) = cl.kind {
                anchors.push(PendingAnchor {
                    drawing: Arc::new(pb.inline.objects[o as usize].clone()),
                    para_top,
                    line_top: top,
                    char_x: x + pb.lines.x[c],
                    story: pb.story.clone(),
                });
            }
        }
        for &(at, endnote, id) in &pb.inline.notes {
            if at >= line.start && at < line.end && !endnote {
                notes.push((endnote, id));
            }
        }
    }
    lines
        .get(first..last)
        .map_or(0.0, |ls| ls.iter().map(|l| l.height).sum())
}

/// Lays out the children of `parent` in `story`.
pub(in crate::layout) fn stack_story(
    env: &Env<'_>,
    story: &Story,
    parent: Option<&BlockId>,
    sc: &StackCtx,
) -> Stack {
    let mut blocks: Vec<&Block> = Vec::new();
    super::flow_blocks(story, parent, &mut blocks);
    stack_blocks(env, story, &blocks, sc, true)
}

/// Lays out `blocks` of `story` top to bottom; with `frames`, paragraphs
/// in text frames are taken out of the flow.
pub(in crate::layout) fn stack_blocks(
    env: &Env<'_>,
    story: &Story,
    blocks: &[&Block],
    sc: &StackCtx,
    frames: bool,
) -> Stack {
    let mut out = Stack::default();
    let mut y = 0.0f32;
    let mut prev: Option<PrevPara> = None;
    let mut skip_to = 0;
    for (i, b) in blocks.iter().enumerate() {
        if i < skip_to {
            continue;
        }
        if frames
            && b.kind == BlockKind::Paragraph
            && let Some((mut f, end)) = frame_box(env, story, blocks, i, sc)
        {
            skip_to = end;
            f.para_top = y;
            // Text continues below a frame anchored to it that allows
            // nothing beside it.
            let band = if f.wrap() == FrameWrap::NotBeside && f.follows_text() {
                f.height
            } else {
                0.0
            };
            if sc.float_frames {
                out.frames.push(f);
            } else {
                let rect = place_in_container(&f, sc.width);
                emit_frame(&f, rect, &mut out.items, &mut out.anchors);
            }
            y += band;
            continue;
        }
        match b.kind {
            BlockKind::Paragraph => {
                let pb = para_box(
                    env,
                    b,
                    &sc.story,
                    sc.width,
                    &sc.table,
                    &sc.fields,
                    sc.note_number.as_deref(),
                    None,
                );
                let props = &pb.format.props;
                let gap_top = y;
                y += space_before(
                    props,
                    prev.as_ref(),
                    i == 0,
                    !env.doc.parts().settings.html_auto_spacing,
                );
                let next = blocks
                    .get(i + 1)
                    .filter(|n| n.kind == BlockKind::Paragraph)
                    .map(|n| env.formats.paragraph(&n.props, &sc.table));
                let join = BorderJoin::new(
                    props,
                    prev.as_ref().map(|p| &p.border),
                    next.as_ref().map(|f| &f.props),
                );
                let (bt, bb) = border_space(props, join);
                // A box shared with the previous paragraph spans the gap too.
                let top = if join.prev { gap_top } else { y };
                y += bt;
                let n = pb.lines.lines.len();
                let h = emit_lines(
                    &pb,
                    0,
                    n,
                    0.0,
                    y,
                    &mut out.items,
                    &mut out.anchors,
                    &mut out.notes,
                    top,
                );
                y += h + bb;
                if props.shading.is_some() || props.borders.any() {
                    let mut deco = Vec::new();
                    decorate(props, 0.0, top, y, true, true, sc.width, join, &mut deco);
                    // Decorations go under the text.
                    let at = out.items.len() - n;
                    out.items.splice(at..at, deco);
                }
                prev = Some(prev_record(props));
            }
            BlockKind::Table => {
                // A table ends the run of paragraphs for spacing purposes.
                if let Some(p) = prev.take() {
                    y += p.after;
                }
                let tb = table_box(env, story, b, sc.width, &sc.story, &sc.fields);
                let mut ty = y;
                for r in 0..tb.rows.len() {
                    emit_row(
                        &tb,
                        r,
                        0.0,
                        ty,
                        &mut out.items,
                        &mut out.anchors,
                        &mut out.notes,
                    );
                    ty += tb.rows[r].height;
                }
                y = ty;
            }
            _ => {}
        }
    }
    if let Some(p) = prev {
        y += p.after;
    }
    out.height = y;
    out
}

/// A cell laid out.
#[derive(Clone, Debug)]
pub struct CellBox {
    /// Geometry and formatting.
    pub geom: CellGeom,
    /// X from the table's left edge.
    pub x: f32,
    /// Width.
    pub width: f32,
    /// Content (relative to the content area).
    pub content: Stack,
    /// Rows the cell spans (vertical merge); 0 for a merged continuation.
    pub rows: usize,
}

/// A row laid out.
#[derive(Clone, Debug)]
pub struct RowBox {
    /// Height.
    pub height: f32,
    /// Cells.
    pub cells: Vec<CellBox>,
    /// Keep the row on one page.
    pub cant_split: bool,
    /// Repeat on each page.
    pub header: bool,
    /// Width of the border line along the row's top: the row makes room
    /// for it above its cells' content.
    pub border_top: f32,
    /// Width of the border line along the row's bottom when the row makes
    /// room for it too (the last row of the table).
    pub border_bottom: f32,
}

/// A table laid out (rows not yet placed).
#[derive(Clone, Debug)]
pub struct TableBox {
    /// Geometry.
    pub geom: TableGeom,
    /// Rows.
    pub rows: Vec<RowBox>,
}

/// Lays out a table's rows within a container `avail` wide.
pub(in crate::layout) fn table_box(
    env: &Env<'_>,
    story: &Story,
    table: &Block,
    avail: f32,
    story_ref: &StoryRef,
    fields: &FieldValues,
) -> TableBox {
    let geom = geometry(story, table, &env.formats, avail);
    let mut rows: Vec<RowBox> = Vec::with_capacity(geom.rows.len());
    let row_count = geom.rows.len();
    for (ri, row) in geom.rows.iter().enumerate() {
        let mut cells = Vec::with_capacity(row.cells.len());
        let mut content_h: f32 = 0.0;
        for cell in &row.cells {
            let width: f32 = geom.cols
                [cell.col.min(geom.cols.len())..(cell.col + cell.span).min(geom.cols.len())]
                .iter()
                .sum();
            // Right-to-left tables put the first column at the right.
            let x = if geom.tbl.bidi == Some(true) {
                geom.width() - geom.col_x(cell.col) - width
            } else {
                geom.col_x(cell.col)
            };
            let inner = (width - cell.margins[1] - cell.margins[3]).max(4.0);
            let continuation = cell.v_merge == Some(VMerge::Continue);
            let content = if continuation {
                Stack::default()
            } else {
                stack_story(
                    env,
                    story,
                    Some(&cell.id),
                    &StackCtx {
                        story: story_ref.clone(),
                        width: inner,
                        table: cell.ctx.clone(),
                        fields: fields.clone(),
                        note_number: None,
                        float_frames: false,
                    },
                )
            };
            if cell.v_merge.is_none() {
                content_h = content_h.max(content.height + cell.margins[0] + cell.margins[2]);
            }
            cells.push(CellBox {
                geom: cell.clone(),
                x,
                width,
                content,
                rows: usize::from(!continuation),
            });
        }
        // Horizontal borders take room of their own: the one along the top
        // of each row, and the one along the bottom of the last row.
        let border_top = border_room(
            row.cells
                .iter()
                .filter(|c| c.v_merge != Some(VMerge::Continue))
                .map(|c| c.borders[0]),
        );
        let border_bottom = if ri + 1 == row_count {
            border_room(row.cells.iter().map(|c| c.borders[2]))
        } else {
            0.0
        };
        let content_h = content_h + border_top + border_bottom;
        let height = match row.tr.height {
            Some((h, HeightRule::Exact)) if h > 0.0 => h,
            Some((h, HeightRule::AtLeast)) => content_h.max(h),
            _ => content_h,
        };
        // An empty row still shows its end-of-row mark's line.
        let height = if height <= 0.0 { 12.0 } else { height };
        rows.push(RowBox {
            height,
            cells,
            cant_split: row.tr.cant_split.unwrap_or(false),
            header: row.tr.header.unwrap_or(false),
            border_top,
            border_bottom,
        });
    }
    // Vertical merges: spans, and growing the last spanned row to fit.
    for r in 0..rows.len() {
        for c in 0..rows[r].cells.len() {
            if rows[r].cells[c].geom.v_merge != Some(VMerge::Restart) {
                continue;
            }
            let col = rows[r].cells[c].geom.col;
            let mut span = 1;
            while r + span < rows.len()
                && rows[r + span]
                    .cells
                    .iter()
                    .any(|x| x.geom.col == col && x.geom.v_merge == Some(VMerge::Continue))
            {
                span += 1;
            }
            rows[r].cells[c].rows = span;
            let cell = &rows[r].cells[c];
            let need = cell.content.height
                + cell.geom.margins[0]
                + cell.geom.margins[2]
                + rows[r].border_top
                + rows[r + span - 1].border_bottom;
            let have: f32 = rows[r..r + span].iter().map(|x| x.height).sum();
            if need > have {
                rows[r + span - 1].height += need - have;
            }
        }
    }
    TableBox { geom, rows }
}

/// The room the widest of `borders` takes.
fn border_room(borders: impl Iterator<Item = Option<Border>>) -> f32 {
    borders
        .flatten()
        .map(|b| b.total_width())
        .fold(0.0, f32::max)
}

/// Emits row `r` with its top-left table corner at (x, y) (x = the
/// container's text area left; the table's own offset is added).
pub(super) fn emit_row(
    tb: &TableBox,
    r: usize,
    x: f32,
    y: f32,
    out: &mut Vec<Item>,
    anchors: &mut Vec<PendingAnchor>,
    notes: &mut Vec<(bool, i64)>,
) {
    let row = &tb.rows[r];
    let tx = x + tb.geom.left;
    for cell in &row.cells {
        if cell.rows == 0 {
            continue;
        }
        let h: f32 = tb.rows[r..(r + cell.rows).min(tb.rows.len())]
            .iter()
            .map(|x| x.height)
            .sum();
        let cx = tx + cell.x;
        let g = &cell.geom;
        if let Some(color) = g.shading {
            out.push(Item::Fill {
                rect: Rect::from_xywh(cx, y, cell.width, h),
                color,
            });
        }
        let last = (r + cell.rows).min(tb.rows.len()) - 1;
        let (top_room, bottom_room) = (row.border_top, tb.rows[last].border_bottom);
        let content_h = cell.content.height;
        let avail = h - g.margins[0] - g.margins[2] - top_room - bottom_room;
        let dy = match g.tc.v_align.as_deref() {
            Some("center") => ((avail - content_h) / 2.0).max(0.0),
            Some("bottom") => (avail - content_h).max(0.0),
            _ => 0.0,
        };
        let content_y = y + top_room + g.margins[0] + dy;
        let mut items = cell.content.items.clone();
        super::offset_items(&mut items, cx + g.margins[1], content_y);
        let exact = matches!(tb.geom.rows[r].tr.height, Some((_, HeightRule::Exact)));
        if exact {
            let clip = Rect::from_xywh(cx, y, cell.width, h);
            for it in &mut items {
                if let Item::Line(l) = it {
                    l.clip = Some(clip);
                }
            }
        }
        out.extend(items);
        for a in &cell.content.anchors {
            let mut a = a.clone();
            a.para_top += content_y;
            a.line_top += content_y;
            a.char_x += cx + g.margins[1];
            anchors.push(a);
        }
        notes.extend(cell.content.notes.iter().copied());
        // Borders: the bottom of a merged span comes from its last row.
        let bottom = if cell.rows > 1 {
            tb.rows
                .get(r + cell.rows - 1)
                .and_then(|last| last.cells.iter().find(|c| c.geom.col == g.col))
                .map_or(g.borders[2], |c| c.geom.borders[2])
        } else {
            g.borders[2]
        };
        // Horizontal lines run along the middle of the room made for them:
        // a row's top, or the next row's top for a bottom border.
        let top = y + top_room / 2.0;
        let bottom_y = match tb.rows.get(last + 1) {
            Some(next) => y + h + next.border_top / 2.0,
            None => y + h - bottom_room / 2.0,
        };
        let edges = [
            (g.borders[0], cx, top, cx + cell.width, top),
            (g.borders[1], cx, y, cx, y + h),
            (bottom, cx, bottom_y, cx + cell.width, bottom_y),
            (g.borders[3], cx + cell.width, y, cx + cell.width, y + h),
        ];
        for (border, x0, y0, x1, y1) in edges {
            if let Some(border) = border {
                out.push(Item::Rule {
                    x0,
                    y0,
                    x1,
                    y1,
                    border,
                });
            }
        }
        if let Some(d) = g.diagonals[0] {
            out.push(Item::Rule {
                x0: cx,
                y0: y,
                x1: cx + cell.width,
                y1: y + h,
                border: d,
            });
        }
        if let Some(d) = g.diagonals[1] {
            out.push(Item::Rule {
                x0: cx + cell.width,
                y0: y,
                x1: cx,
                y1: y + h,
                border: d,
            });
        }
    }
}

/// Line height of a single-line paragraph with `props` at `size` points
/// (used for estimates).
pub fn nominal_line(props: &ParaProps, size: f32) -> f32 {
    match props.line {
        LineSpacing::Auto(m) => size * 1.15 * m,
        LineSpacing::Exact(v) => v,
        LineSpacing::AtLeast(v) => v.max(size * 1.15),
    }
}

/// A drawing placed at a rectangle.
pub fn placed(drawing: Arc<super::super::drawing::Drawing>, rect: Rect, story: StoryRef) -> Item {
    Item::Drawing(PlacedDrawing {
        drawing,
        rect,
        story,
    })
}
