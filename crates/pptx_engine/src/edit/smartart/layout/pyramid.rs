//! Basic Pyramid: a triangle cut into levels of equal height, the first
//! node at the top.

use super::{Diagram, Measure, Placed, Sizes, TextBox, TextSource, fit_canvas, node_label};
use crate::path::Rect;

/// Basic Pyramid (`pyramid1`): the top level is a triangle, the others
/// trapezoids, together an isosceles triangle 0.87 times as high as wide.
pub(super) fn pyramid(
    d: &Diagram,
    w: f32,
    h: f32,
    _f: Sizes,
    _m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    let roots = d.roots();
    let n = roots.len();
    if n == 0 {
        return Some(Vec::new());
    }
    let (base, height) = (1.0_f32, 0.87_f32);
    let lh = height / n as f32;
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let bottom_w = base * (k + 1) as f32 / n as f32;
        let x = (base - bottom_w) / 2.0;
        let y = k as f32 * lh;
        let rect = Rect::from_xywh(x, y, bottom_w, lh);
        // How far the slanted sides reach in from the bottom corners.
        let inset = base / (2.0 * n as f32);
        let placed = if k == 0 {
            let text_rect =
                Rect::from_xywh(x + bottom_w * 0.25, y + lh * 0.4, bottom_w * 0.5, lh * 0.6);
            let text = TextBox::new(TextSource::NodeAndBelow(node), text_rect, 0.1);
            Placed::node("triangle", rect, &node_label(1), node, text).adj(&[("adj", 50000)])
        } else {
            let text_rect = Rect::from_xywh(x + inset, y, bottom_w - 2.0 * inset, lh);
            let text = TextBox::new(TextSource::NodeAndBelow(node), text_rect, 0.1);
            let ss = bottom_w.min(lh);
            let adj = ((inset / ss) * 100_000.0).round() as i64;
            Placed::node("trapezoid", rect, &node_label(1), node, text).adj(&[("adj", adj)])
        };
        out.push(placed);
    }
    fit_canvas(&mut out, base, height, w, h, f32::MAX);
    Some(out)
}
