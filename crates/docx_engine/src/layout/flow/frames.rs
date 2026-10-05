//! Text frames (`w:framePr`): paragraphs taken out of the flow and placed
//! at a position of their own, with the surrounding text flowing beside or
//! below them.

use super::super::Item;
use super::super::format::ParaFormat;
use super::Env;
use super::anchors::PageGeom;
use super::stack::{PendingAnchor, StackCtx, stack_blocks};
use crate::model::block::{Block, BlockKind, Story};
use crate::model::props::{FramePr, HeightRule};
use pptx_engine::path::Rect;

/// Width added to an automatic frame's content so it does not wrap again.
const AUTO_WIDTH_SLACK: f32 = 0.5;

/// How text flows around a frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameWrap {
    /// Text flows beside the frame where there is room.
    Beside,
    /// No text beside the frame: it takes its band of the page.
    NotBeside,
    /// Text ignores the frame.
    None,
}

/// A frame laid out, waiting for its position.
#[derive(Clone, Debug)]
pub struct PendingFrame {
    /// Content, relative to the frame's top-left corner.
    pub items: Vec<Item>,
    /// Floating drawings inside, relative to the frame's top-left corner.
    pub anchors: Vec<PendingAnchor>,
    /// Width.
    pub width: f32,
    /// Height.
    pub height: f32,
    /// Placement.
    pub props: FramePr,
    /// Top of the text the frame is anchored to (container coordinates).
    pub para_top: f32,
    /// Left of the text area the frame is anchored in (container coordinates).
    pub text_left: f32,
}

impl PendingFrame {
    /// How text flows around it.
    pub fn wrap(&self) -> FrameWrap {
        match self.props.wrap.as_deref() {
            Some("notBeside") => FrameWrap::NotBeside,
            Some("none") => FrameWrap::None,
            _ => FrameWrap::Beside,
        }
    }

    /// Whether it sits in the flow of its text rather than on the page.
    pub fn follows_text(&self) -> bool {
        self.props.y_align.as_deref() == Some("inline")
            || (self.props.v_anchor.as_deref() == Some("text") && self.props.y_align.is_none())
    }

    /// Moves it by (dx, dy) along with its container.
    pub fn offset(&mut self, dx: f32, dy: f32) {
        self.para_top += dy;
        self.text_left += dx;
    }
}

/// The frame a paragraph format puts its paragraph in (drop caps aside).
pub fn frame_of(format: &ParaFormat) -> Option<&FramePr> {
    format.props.frame.as_ref().filter(|f| f.drop_cap.is_none())
}

/// Lays out the frame that starts at `blocks[i]`: it holds the following
/// paragraphs with the same frame properties. Returns the frame and the
/// index after its last block.
pub(in crate::layout) fn frame_box(
    env: &Env<'_>,
    story: &Story,
    blocks: &[&Block],
    i: usize,
    sc: &StackCtx,
) -> Option<(PendingFrame, usize)> {
    let fmt = env.formats.paragraph(&blocks[i].props, &sc.table);
    let props = frame_of(&fmt)?.clone();
    let mut j = i + 1;
    while j < blocks.len()
        && blocks[j].kind == BlockKind::Paragraph
        && frame_of(&env.formats.paragraph(&blocks[j].props, &sc.table)) == Some(&props)
    {
        j += 1;
    }
    let content = &blocks[i..j];
    let layout = |width: f32| {
        let ctx = StackCtx {
            story: sc.story.clone(),
            width,
            table: sc.table.clone(),
            fields: sc.fields.clone(),
            note_number: sc.note_number.clone(),
            float_frames: false,
            page: None,
        };
        stack_blocks(env, story, content, &ctx, false)
    };
    let (stack, width) = match props.w.filter(|w| *w > 1.0) {
        Some(w) => (layout(w), w),
        None => {
            // An automatic width fits the content.
            let full = layout(sc.width);
            let used = content_width(&full.items).min(sc.width);
            if used + AUTO_WIDTH_SLACK < sc.width {
                let w = used + AUTO_WIDTH_SLACK;
                (layout(w), w)
            } else {
                (full, sc.width)
            }
        }
    };
    let height = match (props.h, props.h_rule) {
        (Some(h), Some(HeightRule::Exact)) if h > 0.0 => h,
        (_, Some(HeightRule::Auto)) | (None, _) => stack.height,
        (Some(h), _) => stack.height.max(h),
    };
    Some((
        PendingFrame {
            items: stack.items,
            anchors: stack.anchors,
            width,
            height,
            props,
            para_top: 0.0,
            text_left: 0.0,
        },
        j,
    ))
}

/// The right edge of the widest line in `items`.
fn content_width(items: &[Item]) -> f32 {
    items
        .iter()
        .filter_map(|i| match i {
            Item::Line(l) => {
                let line = l.line();
                Some(l.x + line.left + line.width)
            }
            _ => None,
        })
        .fold(0.0, f32::max)
}

/// Where a frame `width` wide goes across a page, `text_left` being the
/// left edge of the text it is anchored in.
fn frame_x(p: &FramePr, width: f32, text_left: f32, g: &PageGeom) -> f32 {
    let (x0, span) = match p.h_anchor.as_deref() {
        Some("margin") => (g.left, g.width - g.left - g.right),
        Some("text") => (text_left, g.col_width),
        _ => (0.0, g.width),
    };
    match p.x_align.as_deref() {
        Some("center") => x0 + (span - width) / 2.0,
        Some("right" | "outside") => x0 + span - width,
        Some("left" | "inside") => x0,
        _ => x0 + p.x.unwrap_or(0.0),
    }
}

/// Whether frame `f` of a stack laid out in the column of `g` stands
/// across that column's text: a frame wholly in a margin leaves it alone.
pub fn across_text(f: &PendingFrame, g: &PageGeom) -> bool {
    let x = frame_x(&f.props, f.width, g.col_left, g);
    x < g.col_left + g.col_width && x + f.width > g.col_left
}

/// Where a frame goes on a page.
pub fn resolve_frame(f: &PendingFrame, g: &PageGeom) -> Rect {
    let p = &f.props;
    let x = frame_x(p, f.width, f.text_left, g);
    let y = if f.follows_text() {
        f.para_top + p.y.unwrap_or(0.0)
    } else {
        let (y0, vspan) = match p.v_anchor.as_deref() {
            Some("page") => (0.0, g.height),
            Some("text") => (f.para_top, 0.0),
            _ => (g.top, g.height - g.top - g.bottom),
        };
        match p.y_align.as_deref() {
            Some("center") => y0 + (vspan - f.height) / 2.0,
            Some("bottom" | "outside") => y0 + vspan - f.height,
            Some("top" | "inside") => y0,
            _ => y0 + p.y.unwrap_or(0.0),
        }
    };
    Rect::from_xywh(x, y, f.width, f.height)
}

/// A frame placed in its container without page knowledge (table cells):
/// beside its text, aligned within the container's width.
pub fn place_in_container(f: &PendingFrame, width: f32) -> Rect {
    let p = &f.props;
    let x = match p.x_align.as_deref() {
        Some("center") => (width - f.width) / 2.0,
        Some("right" | "outside") => width - f.width,
        Some("left" | "inside") => 0.0,
        _ => 0.0,
    };
    Rect::from_xywh(f.text_left + x, f.para_top, f.width, f.height)
}

/// Emits a frame's content at `rect`, and its floating drawings.
pub fn emit_frame(
    f: &PendingFrame,
    rect: Rect,
    out: &mut Vec<Item>,
    anchors: &mut Vec<PendingAnchor>,
) {
    let mut items = f.items.clone();
    super::offset_items(&mut items, rect.x, rect.y);
    out.extend(items);
    for a in &f.anchors {
        let mut a = a.clone();
        a.shift(rect.x, rect.y);
        anchors.push(a);
    }
}
