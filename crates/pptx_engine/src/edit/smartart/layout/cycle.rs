//! Circular layouts: Basic Cycle, Basic Radial, and Basic Venn.

use super::{Diagram, Geom, Measure, Placed, Sizes, TextBox, TextSource, fit_canvas, node_label};
use crate::path::Rect;
use std::f32::consts::PI;

/// The text rectangle inscribed in a circle.
fn inscribed(r: Rect) -> Rect {
    let k = 0.146_45;
    Rect::from_xywh(
        r.x + r.w * k,
        r.y + r.h * k,
        r.w * (1.0 - 2.0 * k),
        r.h * (1.0 - 2.0 * k),
    )
}

/// The angle (radians, clockwise from the top) of item `i` of `n`.
fn angle(i: usize, n: usize) -> f32 {
    -PI / 2.0 + 2.0 * PI * i as f32 / n.max(1) as f32
}

/// Basic Cycle (`cycle2`): circles around a ring, clockwise from the top,
/// with an arrow between each pair pointing along the ring.
pub(super) fn basic_cycle(
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
    let radius = 1.0_f32;
    let chord = if n == 1 {
        2.0
    } else {
        2.0 * radius * (PI / n as f32).sin()
    };
    let dia = (0.62 * chord).min(1.1 * radius).max(0.3);
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let a = angle(k, n);
        let (cx, cy) = if n == 1 {
            (0.0, 0.0)
        } else {
            (radius * a.cos(), radius * a.sin())
        };
        let rect = Rect::from_xywh(cx - dia / 2.0, cy - dia / 2.0, dia, dia);
        let text = TextBox::new(TextSource::NodeAndBelow(node), inscribed(rect), 0.1);
        out.push(Placed::node("ellipse", rect, &node_label(1), node, text));
    }
    if n > 1 {
        let gap = (chord - dia).max(0.0);
        let len = (0.6 * gap).min(0.4 * dia);
        let thick = len * 0.6;
        for k in 0..n {
            let mid = angle(k, n) + PI / n as f32;
            let (cx, cy) = (radius * mid.cos(), radius * mid.sin());
            let rect = Rect::from_xywh(cx - len / 2.0, cy - thick / 2.0, len, thick);
            let mut p = Placed::shape("rightArrow", rect, "sibTrans2D1")
                .adj(&[("adj1", 60000), ("adj2", 50000)]);
            p.rot = (mid.to_degrees() + 90.0).rem_euclid(360.0);
            p.node = Some(roots[(k + 1) % n]);
            out.push(p);
        }
    }
    let half = if n == 1 {
        dia / 2.0
    } else {
        radius + dia / 2.0
    };
    for p in &mut out {
        p.rect.x += half;
        p.rect.y += half;
        if let Some(t) = &mut p.text {
            t.rect.x += half;
            t.rect.y += half;
        }
    }
    fit_canvas(&mut out, 2.0 * half, 2.0 * half, w, h, f32::MAX);
    Some(out)
}

/// Basic Radial (`radial1`): the first top-level node in a circle at the
/// center, its children in circles around it, joined by spokes.
pub(super) fn radial(
    d: &Diagram,
    w: f32,
    h: f32,
    _f: Sizes,
    _m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    let Some(&center) = d.roots().first() else {
        return Some(Vec::new());
    };
    let kids = d.nodes[center].children.clone();
    let m = kids.len();
    let dia = 1.0_f32;
    let big = 1.35 * dia;
    let radius = if m == 0 {
        0.0
    } else {
        (big / 2.0 + 0.35 * dia + dia / 2.0).max(if m > 1 {
            0.6 * dia / (PI / m as f32).sin()
        } else {
            0.0
        })
    };
    let mut out = Vec::new();
    // Spokes first, behind the circles.
    for (k, &kid) in kids.iter().enumerate() {
        let a = angle(k, m);
        let (from, to) = (big / 2.0, radius - dia / 2.0);
        let (x1, y1) = (from * a.cos(), from * a.sin());
        let (x2, y2) = (to * a.cos(), to * a.sin());
        let rect = Rect::from_ltrb(x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2));
        let mut p = Placed::shape("line", rect, "parChTrans1D2");
        p.geom = Geom::Lines(vec![vec![
            (x1 - rect.x, y1 - rect.y),
            (x2 - rect.x, y2 - rect.y),
        ]]);
        p.node = Some(kid);
        out.push(p);
    }
    let crect = Rect::from_xywh(-big / 2.0, -big / 2.0, big, big);
    let text = TextBox::new(TextSource::Node(center), inscribed(crect), 0.1);
    out.push(Placed::node("ellipse", crect, "node0", center, text));
    for (k, &kid) in kids.iter().enumerate() {
        let a = angle(k, m);
        let (cx, cy) = (radius * a.cos(), radius * a.sin());
        let rect = Rect::from_xywh(cx - dia / 2.0, cy - dia / 2.0, dia, dia);
        let text = TextBox::new(TextSource::NodeAndBelow(kid), inscribed(rect), 0.1);
        out.push(Placed::node("ellipse", rect, &node_label(1), kid, text));
    }
    let half = if m == 0 {
        big / 2.0
    } else {
        radius + dia / 2.0
    };
    for p in &mut out {
        p.rect.x += half;
        p.rect.y += half;
        if let Some(t) = &mut p.text {
            t.rect.x += half;
            t.rect.y += half;
        }
    }
    fit_canvas(&mut out, 2.0 * half, 2.0 * half, w, h, f32::MAX);
    Some(out)
}

/// Basic Venn (`venn1`): overlapping translucent circles around a center,
/// each node's text in the part of its circle away from the others.
pub(super) fn venn(
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
    let dia = 1.0_f32;
    let offset = match n {
        1 => 0.0,
        2 => 0.3 * dia,
        3 => 0.36 * dia,
        _ => 0.5 * dia / (PI / n as f32).sin().max(0.2) * 0.62,
    };
    let mut out = Vec::new();
    for (k, &node) in roots.iter().enumerate() {
        let a = if n == 2 {
            if k == 0 { PI } else { 0.0 }
        } else {
            angle(k, n)
        };
        let (cx, cy) = (offset * a.cos(), offset * a.sin());
        let rect = Rect::from_xywh(cx - dia / 2.0, cy - dia / 2.0, dia, dia);
        let text_rect = if n == 1 {
            inscribed(rect)
        } else {
            let (tw, th) = (0.56 * dia, 0.36 * dia);
            let reach = 0.2 * dia;
            Rect::from_xywh(
                cx + reach * a.cos() - tw / 2.0,
                cy + reach * a.sin() - th / 2.0,
                tw,
                th,
            )
        };
        let text = TextBox::new(TextSource::NodeAndBelow(node), text_rect, 0.1);
        out.push(Placed::node("ellipse", rect, "vennNode1", node, text));
    }
    let (mut l, mut t, mut r, mut b) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in &out {
        l = l.min(p.rect.x);
        t = t.min(p.rect.y);
        r = r.max(p.rect.right());
        b = b.max(p.rect.bottom());
    }
    for p in &mut out {
        p.rect.x -= l;
        p.rect.y -= t;
        if let Some(tb) = &mut p.text {
            tb.rect.x -= l;
            tb.rect.y -= t;
        }
    }
    fit_canvas(&mut out, r - l, b - t, w, h, f32::MAX);
    Some(out)
}
