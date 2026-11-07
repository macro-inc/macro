//! Process layouts: Basic Process and Basic Chevron Process.

use super::lists::inner_round_rect;
use super::{Diagram, Measure, Placed, Sizes, TextBox, TextSource, fit_canvas, node_label};
use crate::path::Rect;

/// Basic Process (`process1`): rounded rectangles (height 0.6 × width) in
/// a row, with a right arrow in each gap (gaps 0.4 × width).
pub(super) fn basic_process(
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
    // Canvas units: node width 1.
    let (nw, nh, gap) = (1.0_f32, 0.6_f32, 0.4_f32);
    let (aw, ah) = (gap * 0.55, nh * 0.32);
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let x = k as f32 * (nw + gap);
        let rect = Rect::from_xywh(x, 0.0, nw, nh);
        let text = TextBox::new(
            TextSource::NodeAndBelow(node),
            inner_round_rect(rect, 0.1),
            0.3,
        );
        out.push(
            Placed::node("roundRect", rect, &node_label(1), node, text).adj(&[("adj", 10000)]),
        );
        if k + 1 < n {
            let ax = x + nw + (gap - aw) / 2.0;
            let arrow = Rect::from_xywh(ax, (nh - ah) / 2.0, aw, ah);
            let mut p = Placed::shape("rightArrow", arrow, "sibTrans2D1")
                .adj(&[("adj1", 60000), ("adj2", 50000)]);
            p.node = Some(roots[k + 1]);
            out.push(p);
        }
    }
    let cw = n as f32 * nw + (n as f32 - 1.0) * gap;
    fit_canvas(&mut out, cw, nh, w, h, f32::MAX);
    Some(out)
}

/// Basic Chevron Process (`chevron1`): chevrons (height 0.4 × width) in a
/// row, each nested into the next with a small gap.
pub(super) fn chevron(
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
    let (cw, ch) = (1.0_f32, 0.4_f32);
    let step = cw - 0.1;
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let rect = Rect::from_xywh(k as f32 * step, 0.0, cw, ch);
        // Text keeps clear of the notch and the point.
        let inner = Rect::from_xywh(rect.x + ch / 2.0, rect.y, cw - ch, ch);
        let mut text = TextBox::new(TextSource::NodeAndBelow(node), inner, 0.1);
        text.margins = [0.1, 0.1, 0.1, 0.1];
        out.push(Placed::node("chevron", rect, &node_label(1), node, text).adj(&[("adj", 50000)]));
    }
    let width = (n as f32 - 1.0) * step + cw;
    fit_canvas(&mut out, width, ch, w, h, f32::MAX);
    Some(out)
}
