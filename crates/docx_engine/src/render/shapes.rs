//! DrawingML shapes, groups and charts.

use super::Renderer;
use crate::layout::drawing::Drawing;
use pptx_engine::path::Rect;
use pptx_engine::render::scene::Node;

/// Draws a non-picture graphic in `rect`.
pub(super) fn graphic_nodes(
    _r: &mut Renderer<'_>,
    _d: &Drawing,
    _rect: Rect,
    _part: &str,
    _out: &mut Vec<Node>,
) {
}
