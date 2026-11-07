//! List layouts: Basic Block List, Vertical Bullet List, and Horizontal
//! Bullet List.

use super::{Diagram, MM, Measure, Placed, Sizes, TextBox, TextSource, node_label};
use crate::path::Rect;

/// Basic Block List (`default`): equal rectangles (height 0.6 × width, gaps
/// 0.1 × width) filling rows left to right; the column count is the one
/// that makes the blocks largest, and the last row is centered.
pub(super) fn block_list(
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
    let (aspect, gap) = (0.6, 0.1);
    let (cols, bw) = (1..=n)
        .map(|c| {
            let rows = n.div_ceil(c);
            let by_w = w / (c as f32 * (1.0 + gap) - gap);
            let by_h = h / (rows as f32 * (aspect + gap) - gap);
            (c, by_w.min(by_h))
        })
        .fold(
            (1, 0.0_f32),
            |best, c| if c.1 > best.1 + 1e-3 { c } else { best },
        );
    let bh = bw * aspect;
    let rows = n.div_ceil(cols);
    let total_h = rows as f32 * (bh + gap * bw) - gap * bw;
    let top = (h - total_h) / 2.0;
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let (row, col) = (k / cols, k % cols);
        let in_row = if row == rows - 1 {
            n - row * cols
        } else {
            cols
        };
        let row_w = in_row as f32 * (bw + gap * bw) - gap * bw;
        let x = (w - row_w) / 2.0 + col as f32 * bw * (1.0 + gap);
        let y = top + row as f32 * (bh + gap * bw);
        let rect = Rect::from_xywh(x, y, bw, bh);
        let text = TextBox::new(TextSource::NodeAndBelow(node), rect, 0.3);
        out.push(Placed::node("rect", rect, &node_label(1), node, text));
    }
    Some(out)
}

/// Vertical Bullet List (`vList2`): a full-width rounded bar per top-level
/// node, its children as bullets below it, stacked and centered.
pub(super) fn vertical_bullets(
    d: &Diagram,
    w: f32,
    h: f32,
    f: Sizes,
    m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    let roots = d.roots();
    let mut out = Vec::new();
    let mut y = 0.0;
    for (k, &node) in roots.iter().enumerate() {
        let bar = TextBox::new(
            TextSource::Node(node),
            Rect::from_xywh(0.0, 0.0, w, 0.0),
            0.3,
        );
        let mut bar = bar;
        bar.align = super::Align::Left;
        // The rounded corners inset the text area by a fraction of the
        // bar's height (bars are wider than tall).
        const K: f32 = 0.16667 * 0.29289;
        let min_h = m.height(&bar, w, f.primary)?.max(0.52 * f.primary * MM);
        let mut bar_h = min_h;
        for _ in 0..4 {
            let need = m.height(&bar, w - 2.0 * K * bar_h.min(w), f.primary)?;
            let next = min_h.max(need / (1.0 - 2.0 * K) + 0.1);
            if next <= bar_h + 0.01 {
                break;
            }
            bar_h = next;
        }
        let rect = Rect::from_xywh(0.0, y, w, bar_h);
        bar.rect = inner_round_rect(rect, 0.16667);
        out.push(Placed::node("roundRect", rect, &node_label(1), node, bar));
        y += bar_h;
        if d.nodes[node].children.is_empty() {
            if k + 1 < roots.len() {
                y += 0.08 * f.primary * MM;
            }
            continue;
        }
        let mut body = TextBox::new(
            TextSource::Below(node),
            Rect::from_xywh(0.0, y, w, 0.0),
            0.1,
        )
        .top_left();
        body.group = 1;
        body.margins = [
            0.0,
            0.1 * f.primary / f.secondary,
            0.56,
            0.1 * f.primary / f.secondary,
        ];
        body.pad = [0.0317 * w, 0.0, 0.0, 0.0];
        let body_h = m.height(&body, w, f.secondary)?;
        body.rect = Rect::from_xywh(0.0, y, w, body_h);
        let mut p = Placed::shape("rect", body.rect, "revTx");
        p.node = Some(node);
        p.text = Some(body);
        out.push(p);
        y += body_h;
    }
    if y > h + 0.5 {
        return None;
    }
    let dy = (h - y) / 2.0;
    for p in &mut out {
        p.rect.y += dy;
        if let Some(t) = &mut p.text {
            t.rect.y += dy;
        }
    }
    Some(out)
}

/// The text rectangle PowerPoint uses inside a rounded rectangle (the
/// corner radius as a fraction of the shorter side).
pub(super) fn inner_round_rect(r: Rect, radius: f32) -> Rect {
    let inset = r.w.min(r.h) * radius * 0.29289;
    Rect::from_xywh(
        r.x + inset,
        r.y + inset,
        r.w - 2.0 * inset,
        r.h - 2.0 * inset,
    )
}

/// Horizontal Bullet List (`hList1`): a column per top-level node, a
/// header with its text over a body with its children as bullets.
pub(super) fn horizontal_bullets(
    d: &Diagram,
    w: f32,
    h: f32,
    f: Sizes,
    m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    let roots = d.roots();
    let n = roots.len();
    if n == 0 {
        return Some(Vec::new());
    }
    let cw = w / (n as f32 + 0.14 * (n as f32 - 1.0));
    let mut header_h = (0.8 * f.primary * MM).min(0.4 * cw);
    let mut headers = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let x = k as f32 * cw * 1.14;
        let mut t = TextBox::new(
            TextSource::Node(node),
            Rect::from_xywh(x, 0.0, cw, 0.0),
            0.56,
        );
        t.margins = [0.56, 0.32, 0.56, 0.32];
        header_h = header_h.max(m.height(&t, cw, f.primary)?);
        headers.push(t);
    }
    if header_h >= h {
        return None;
    }
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let x = k as f32 * cw * 1.14;
        let mut t = headers[k].clone();
        let rect = Rect::from_xywh(x, 0.0, cw, header_h);
        t.rect = rect;
        out.push(Placed::node("rect", rect, "alignNode1", node, t));
        let body = Rect::from_xywh(x, header_h, cw, h - header_h);
        let mut bt = TextBox::new(TextSource::Below(node), body, 0.42).top_left();
        bt.margins = [0.42, 0.42, 0.56, 0.63];
        bt.group = 1;
        let mut p = Placed::shape("rect", body, "alignAccFollowNode1");
        p.node = Some(node);
        p.text = Some(bt);
        out.push(p);
    }
    Some(out)
}
