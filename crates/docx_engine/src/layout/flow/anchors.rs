//! Positions floating drawings on their page.

use super::super::drawing::RelFrom;
use super::stack::PendingAnchor;
use pptx_engine::path::Rect;

/// The page geometry floating drawings are positioned against.
#[derive(Clone, Copy, Debug)]
pub struct PageGeom {
    /// Page width.
    pub width: f32,
    /// Page height.
    pub height: f32,
    /// Left margin.
    pub left: f32,
    /// Right margin.
    pub right: f32,
    /// Top margin.
    pub top: f32,
    /// Bottom margin.
    pub bottom: f32,
    /// Column left edge.
    pub col_left: f32,
    /// Column width.
    pub col_width: f32,
}

/// The rectangle a floating drawing occupies on the page.
pub fn resolve(a: &PendingAnchor, g: &PageGeom) -> Option<Rect> {
    let d = &a.drawing;
    let anchor = d.anchor.as_ref()?;
    let (w, h) = (d.width, d.height);
    let (x0, span) = match anchor.h.from {
        RelFrom::Page => (0.0, g.width),
        RelFrom::Margin => (g.left, g.width - g.left - g.right),
        RelFrom::Column => a.cell.unwrap_or((g.col_left, g.col_width)),
        RelFrom::Text => (a.char_x, 0.0),
        RelFrom::LeftMargin | RelFrom::InsideMargin => (0.0, g.left),
        RelFrom::RightMargin | RelFrom::OutsideMargin => (g.width - g.right, g.right),
    };
    let x = match anchor.h.align.as_deref() {
        Some("center") => x0 + (span - w) / 2.0,
        Some("right" | "outside") => x0 + span - w,
        Some("left" | "inside") => x0,
        _ => x0 + anchor.h.offset,
    };
    let (y0, vspan) = match anchor.v.from {
        RelFrom::Page => (0.0, g.height),
        RelFrom::Margin => (g.top, g.height - g.top - g.bottom),
        RelFrom::Column => (g.top, g.height - g.top - g.bottom),
        RelFrom::Text => (
            if anchor.v.line {
                a.line_top
            } else {
                a.para_top
            },
            0.0,
        ),
        RelFrom::LeftMargin | RelFrom::InsideMargin => (0.0, g.top),
        RelFrom::RightMargin | RelFrom::OutsideMargin => (g.height - g.bottom, g.bottom),
    };
    let y = match anchor.v.align.as_deref() {
        Some("center") => y0 + (vspan - h) / 2.0,
        Some("bottom" | "outside") => y0 + vspan - h,
        Some("top" | "inside") => y0,
        _ => y0 + anchor.v.offset,
    };
    Some(Rect::from_xywh(x, y, w, h))
}
