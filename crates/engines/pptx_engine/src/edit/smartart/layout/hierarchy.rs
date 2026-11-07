//! Hierarchy layouts: Hierarchy and Organization Chart. Trees grow down
//! from their roots; each parent is centered over its children, and bent
//! connectors join them.

use super::lists::inner_round_rect;
use super::{Diagram, Geom, Measure, Placed, Sizes, TextBox, TextSource, fit_canvas, node_label};
use crate::path::Rect;

/// Proportions of a tree layout, in node widths.
struct Metrics {
    /// Node height.
    h: f32,
    /// Gap between siblings.
    sib: f32,
    /// Gap between levels.
    level: f32,
}

/// Where each node goes: its box's left edge and its row.
struct Tidy<'a> {
    d: &'a Diagram,
    m: &'a Metrics,
    /// Assistants are laid out beside their parent's stem.
    assistants: bool,
    x: Vec<f32>,
    row: Vec<usize>,
}

impl Tidy<'_> {
    fn kids(&self, i: usize) -> Vec<usize> {
        self.d.nodes[i]
            .children
            .iter()
            .copied()
            .filter(|&c| !(self.assistants && self.d.nodes[c].asst))
            .collect()
    }

    fn assistants_of(&self, i: usize) -> Vec<usize> {
        if !self.assistants {
            return Vec::new();
        }
        self.d.nodes[i]
            .children
            .iter()
            .copied()
            .filter(|&c| self.d.nodes[c].asst)
            .collect()
    }

    /// Lays out the subtree of `i` starting at `left` on `row`; returns its width.
    fn place(&mut self, i: usize, left: f32, row: usize) -> f32 {
        self.row[i] = row;
        let assistants = self.assistants_of(i);
        // Assistants take a row of their own below the node.
        let child_row = row + 1 + usize::from(!assistants.is_empty());
        let kids = self.kids(i);
        let mut width: f32 = 0.0;
        if kids.is_empty() {
            width = 1.0;
            self.x[i] = left;
        } else {
            let mut cursor = left;
            for (k, &c) in kids.iter().enumerate() {
                if k > 0 {
                    cursor += self.m.sib;
                }
                cursor += self.place(c, cursor, child_row);
            }
            width = width.max(cursor - left);
            let first = self.x[kids[0]];
            let last = self.x[*kids.last().unwrap_or(&kids[0])];
            self.x[i] = (first + last) / 2.0;
            if self.x[i] < left {
                // A single narrow child: keep the parent inside its span.
                let shift = left - self.x[i];
                self.shift(i, shift);
            }
        }
        // Assistants sit left and right of the stem, alternating.
        for (k, &a) in assistants.iter().enumerate() {
            self.row[a] = row + 1;
            let side = if k % 2 == 0 { -1.0 } else { 1.0 };
            let pair = (k / 2) as f32;
            let stem = self.x[i] + 0.5;
            self.x[a] = if side < 0.0 {
                stem - 0.5 * self.m.sib - 1.0 - pair * (1.0 + self.m.sib)
            } else {
                stem + 0.5 * self.m.sib + pair * (1.0 + self.m.sib)
            };
        }
        let lo = assistants
            .iter()
            .map(|&a| self.x[a])
            .fold(self.x[i], f32::min);
        if lo < left {
            self.shift(i, left - lo);
        }
        let hi = assistants
            .iter()
            .map(|&a| self.x[a] + 1.0)
            .fold(left + width.max(1.0), f32::max);
        hi - left
    }

    fn shift(&mut self, i: usize, dx: f32) {
        self.x[i] += dx;
        for c in self.d.nodes[i].children.clone() {
            self.shift(c, dx);
        }
    }

    fn top(&self, i: usize) -> f32 {
        self.row[i] as f32 * (self.m.h + self.m.level)
    }
}

/// A bent connector from the bottom center of `from` to the top center of
/// `to` (both in canvas coordinates), bending halfway down the gap.
fn elbow(from: (f32, f32), to: (f32, f32), label: &str, node: usize) -> Placed {
    let mid = (from.1 + to.1) / 2.0;
    let rect = Rect::from_ltrb(from.0.min(to.0), from.1, from.0.max(to.0), to.1);
    let pts = vec![
        (from.0 - rect.x, 0.0),
        (from.0 - rect.x, mid - rect.y),
        (to.0 - rect.x, mid - rect.y),
        (to.0 - rect.x, to.1 - rect.y),
    ];
    let mut p = Placed::shape("line", rect, label);
    p.geom = Geom::Lines(vec![pts]);
    p.node = Some(node);
    p
}

/// A connector from a stem at `stem_x` (going down from `top`) across to
/// the side of an assistant box.
fn side_link(stem_x: f32, top: f32, target: Rect, label: &str, node: usize) -> Placed {
    let y = target.y + target.h / 2.0;
    let x = if target.x > stem_x {
        target.x
    } else {
        target.right()
    };
    let rect = Rect::from_ltrb(stem_x.min(x), top, stem_x.max(x), y);
    let pts = vec![
        (stem_x - rect.x, 0.0),
        (stem_x - rect.x, y - rect.y),
        (x - rect.x, y - rect.y),
    ];
    let mut p = Placed::shape("line", rect, label);
    p.geom = Geom::Lines(vec![pts]);
    p.node = Some(node);
    p
}

fn tree<'a>(d: &'a Diagram, m: &'a Metrics, assistants: bool) -> Tidy<'a> {
    let mut t = Tidy {
        d,
        m,
        assistants,
        x: vec![0.0; d.nodes.len()],
        row: vec![0; d.nodes.len()],
    };
    let mut left = 0.0;
    for (k, r) in d.roots().into_iter().enumerate() {
        if k > 0 {
            left += m.sib * 2.0;
        }
        left += t.place(r, left, 0);
    }
    t
}

fn canvas_size(shapes: &[Placed]) -> (f32, f32) {
    shapes.iter().fold((0.0_f32, 0.0_f32), |(w, h), p| {
        (w.max(p.rect.right()), h.max(p.rect.bottom()))
    })
}

/// Organization Chart (`orgChart1`): boxes (height 0.5 × width) by level,
/// assistants beside their manager's stem, bent connectors.
pub(super) fn org_chart(
    d: &Diagram,
    w: f32,
    h: f32,
    _f: Sizes,
    _m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    if d.nodes.is_empty() {
        return Some(Vec::new());
    }
    let m = Metrics {
        h: 0.5,
        sib: 0.21,
        level: 0.35,
    };
    let t = tree(d, &m, true);
    let rect = |i: usize| Rect::from_xywh(t.x[i], t.top(i), 1.0, m.h);
    let mut out = Vec::new();
    for (i, n) in d.nodes.iter().enumerate() {
        let Some(p) = n.parent else {
            continue;
        };
        let (pr, cr) = (rect(p), rect(i));
        let label = format!("parChTrans1D{}", n.depth.clamp(1, 4));
        if n.asst {
            out.push(side_link(pr.x + 0.5, pr.bottom(), cr, &label, i));
        } else {
            out.push(elbow(
                (pr.x + 0.5, pr.bottom()),
                (cr.x + 0.5, cr.y),
                &label,
                i,
            ));
        }
    }
    for (i, n) in d.nodes.iter().enumerate() {
        let r = rect(i);
        let label = if n.parent.is_none() {
            "node0".to_owned()
        } else if n.asst {
            "asst1".to_owned()
        } else {
            node_label(n.depth)
        };
        let text = TextBox::new(TextSource::Node(i), r, 0.05);
        out.push(Placed::node("rect", r, &label, i, text));
    }
    let (cw, ch) = canvas_size(&out);
    fit_canvas(&mut out, cw, ch, w, h, f32::MAX);
    Some(out)
}

/// Hierarchy (`hierarchy1`): each node a light rounded box with its text,
/// offset over a solid rounded box, by level, with bent connectors.
pub(super) fn hierarchy(
    d: &Diagram,
    w: f32,
    h: f32,
    _f: Sizes,
    _m: &mut dyn Measure,
) -> Option<Vec<Placed>> {
    if d.nodes.is_empty() {
        return Some(Vec::new());
    }
    let m = Metrics {
        h: 0.74,
        sib: 0.3,
        level: 0.4,
    };
    let t = tree(d, &m, false);
    // The composite: the back box, and the front box offset by 10%.
    let (bw, bh) = (1.0 / 1.1, m.h / 1.1);
    let back = |i: usize| Rect::from_xywh(t.x[i], t.top(i), bw, bh);
    let front = |i: usize| Rect::from_xywh(t.x[i] + 0.1 * bw, t.top(i) + 0.1 * bh, bw, bh);
    let mut out = Vec::new();
    for (i, n) in d.nodes.iter().enumerate() {
        let Some(p) = n.parent else {
            continue;
        };
        let label = format!("parChTrans1D{}", n.depth.clamp(1, 4));
        out.push(elbow(
            (t.x[p] + 0.5, t.top(p) + m.h),
            (t.x[i] + 0.5, t.top(i)),
            &label,
            i,
        ));
    }
    for (i, n) in d.nodes.iter().enumerate() {
        let level = n.depth.saturating_sub(1).min(4);
        let mut bg =
            Placed::shape("roundRect", back(i), &format!("node{level}")).adj(&[("adj", 10000)]);
        bg.node = Some(i);
        out.push(bg);
        let f = front(i);
        let text = TextBox::new(TextSource::Node(i), inner_round_rect(f, 0.1), 0.1);
        out.push(
            Placed::node("roundRect", f, &format!("fgAcc{level}"), i, text).adj(&[("adj", 10000)]),
        );
    }
    let (cw, ch) = canvas_size(&out);
    fit_canvas(&mut out, cw, ch, w, h, f32::MAX);
    Some(out)
}
