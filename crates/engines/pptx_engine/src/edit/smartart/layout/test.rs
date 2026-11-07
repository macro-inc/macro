//! Layout geometry tests with a simple text measure: shape counts, no
//! overlaps, everything inside the frame, and text boxes inside shapes.

use super::{Diagram, Geom, LNode, Measure, TextBox, lay_out};
use crate::edit::smartart::catalog::Kind;
use crate::path::Rect;

/// Text that is 0.6 em per character, one line per 1.2 em, word wrapped.
struct Approx {
    chars: Vec<usize>,
}

impl Measure for Approx {
    fn height(&mut self, text: &TextBox, width: f32, size: f32) -> Option<f32> {
        let [l, t, r, b] = text.insets(size);
        let room = width - l - r;
        let n = match text.source {
            super::TextSource::Node(i) | super::TextSource::NodeAndBelow(i) => self.chars[i],
            super::TextSource::Below(i) => self.chars[i],
        };
        let per_line = (room / (0.6 * size)).floor();
        if per_line < 4.0 {
            return None;
        }
        let lines = (n as f32 / per_line).ceil().max(1.0);
        Some(lines * size * 1.2 + t + b)
    }
}

/// A diagram from `(depth)` per node in pre-order.
fn diagram(depths: &[usize]) -> Diagram {
    let mut nodes: Vec<LNode> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for (i, &d) in depths.iter().enumerate() {
        stack.truncate(d - 1);
        let parent = stack.last().copied();
        if let Some(p) = parent {
            nodes[p].children.push(i);
        }
        nodes.push(LNode {
            id: format!("n{i}"),
            asst: false,
            parent,
            children: Vec::new(),
            depth: d,
        });
        stack.push(i);
    }
    Diagram { nodes }
}

fn overlap(a: &Rect, b: &Rect) -> bool {
    let e = 0.5;
    a.x + e < b.right() && b.x + e < a.right() && a.y + e < b.bottom() && b.y + e < a.bottom()
}

fn inside(inner: &Rect, outer: &Rect) -> bool {
    let e = 0.5;
    inner.x >= outer.x - e
        && inner.y >= outer.y - e
        && inner.right() <= outer.right() + e
        && inner.bottom() <= outer.bottom() + e
}

/// Lays `depths` out in PowerPoint's default box and checks the common
/// properties; returns the primary node shapes' boxes.
fn check(kind: Kind, depths: &[usize], expect_nodes: usize, may_overlap: bool) -> Vec<Rect> {
    let d = diagram(depths);
    let mut m = Approx {
        chars: vec![8; d.nodes.len()],
    };
    let (w, h) = (640.0, 426.7);
    let laid = lay_out(kind, &d, w, h, &mut m);
    let frame = Rect::from_xywh(0.0, 0.0, w, h);
    let mut boxes = Vec::new();
    for p in &laid.shapes {
        assert!(
            inside(&p.rect, &frame),
            "{kind:?}: {:?} leaves the frame",
            p.rect
        );
        if let Some(t) = &p.text {
            // Text boxes stay within their shape (rotation aside).
            assert!(
                inside(&t.rect, &p.rect),
                "{kind:?}: text {:?} outside {:?}",
                t.rect,
                p.rect
            );
            assert!(
                m.fits(t, laid.sizes.of(t.group)),
                "{kind:?}: text does not fit"
            );
        }
        if p.primary {
            boxes.push(p.rect);
        }
        if let Geom::Lines(lines) = &p.geom {
            assert!(lines.iter().all(|l| l.len() >= 2));
        }
    }
    assert_eq!(boxes.len(), expect_nodes, "{kind:?} node shapes");
    if !may_overlap {
        for (i, a) in boxes.iter().enumerate() {
            for b in &boxes[i + 1..] {
                assert!(!overlap(a, b), "{kind:?}: {a:?} overlaps {b:?}");
            }
        }
    }
    assert!(laid.sizes.primary >= super::MIN_FONT && laid.sizes.primary <= super::MAX_FONT);
    boxes
}

#[test]
fn block_list_fills_rows_and_centers_the_last() {
    let boxes = check(Kind::BlockList, &[1, 1, 1, 1, 1], 5, false);
    // Equal blocks, 0.6 as high as wide.
    assert!(boxes.iter().all(|b| (b.h / b.w - 0.6).abs() < 0.01));
    // The last row is centered.
    let last = boxes.last().unwrap();
    assert!((last.x + last.w / 2.0 - 320.0).abs() < 1.0);
}

#[test]
fn bullet_lists_stack_and_split_columns() {
    let bars = check(Kind::VerticalBullets, &[1, 2, 1, 2, 2, 1], 3, false);
    assert!(bars.windows(2).all(|p| p[0].y < p[1].y));
    let cols = check(Kind::HorizontalBullets, &[1, 2, 1, 2, 1], 3, false);
    assert!(
        cols.windows(2)
            .all(|p| p[0].x < p[1].x && (p[0].y - p[1].y).abs() < 0.1)
    );
}

#[test]
fn processes_run_left_to_right() {
    let boxes = check(Kind::Process, &[1, 1, 1, 1], 4, false);
    assert!(boxes.windows(2).all(|p| p[0].right() < p[1].x));
    let d = diagram(&[1, 1, 1]);
    let laid = lay_out(
        Kind::Process,
        &d,
        640.0,
        426.7,
        &mut Approx { chars: vec![5; 3] },
    );
    let arrows = laid
        .shapes
        .iter()
        .filter(|s| matches!(s.geom, Geom::Preset("rightArrow", _)))
        .count();
    assert_eq!(arrows, 2);
    // Chevrons interlock: each starts before the previous one ends.
    let chevrons = check(Kind::Chevron, &[1, 1, 1], 3, true);
    assert!(
        chevrons
            .windows(2)
            .all(|p| p[1].x < p[0].right() && p[1].x > p[0].x)
    );
}

#[test]
fn cycles_go_around_with_arrows() {
    let boxes = check(Kind::Cycle, &[1, 1, 1, 1, 1], 5, false);
    // The first node is at the top center.
    assert!((boxes[0].x + boxes[0].w / 2.0 - 320.0).abs() < 1.0);
    assert!(boxes.iter().skip(1).all(|b| b.y > boxes[0].y));
    let d = diagram(&[1, 1, 1, 1, 1]);
    let laid = lay_out(
        Kind::Cycle,
        &d,
        640.0,
        426.7,
        &mut Approx { chars: vec![5; 5] },
    );
    assert_eq!(
        laid.shapes
            .iter()
            .filter(|s| s.label == "sibTrans2D1" && s.rot != 0.0)
            .count(),
        5
    );
}

#[test]
fn radial_puts_the_first_node_in_the_middle() {
    let boxes = check(Kind::Radial, &[1, 2, 2, 2, 2], 5, false);
    let center = boxes[0];
    assert!((center.x + center.w / 2.0 - 320.0).abs() < 1.0);
    assert!(boxes.iter().skip(1).all(|b| b.w < center.w));
}

#[test]
fn hierarchies_put_parents_over_their_children() {
    let boxes = check(Kind::OrgChart, &[1, 2, 3, 3, 2], 5, false);
    let (root, a, a1, a2) = (boxes[0], boxes[1], boxes[2], boxes[3]);
    assert!(root.bottom() < a.y && a.bottom() < a1.y);
    let mid = |r: Rect| r.x + r.w / 2.0;
    assert!((mid(a) - (mid(a1) + mid(a2)) / 2.0).abs() < 1.0);
    check(Kind::Hierarchy, &[1, 2, 3, 3, 2, 3], 6, false);
}

#[test]
fn org_chart_assistants_sit_beside_the_stem() {
    let mut d = diagram(&[1, 2, 2, 2]);
    d.nodes[1].asst = true;
    let laid = lay_out(
        Kind::OrgChart,
        &d,
        640.0,
        426.7,
        &mut Approx { chars: vec![5; 4] },
    );
    let boxes: Vec<Rect> = laid
        .shapes
        .iter()
        .filter(|s| s.primary)
        .map(|s| s.rect)
        .collect();
    let (root, asst, kid) = (boxes[0], boxes[1], boxes[2]);
    // The assistant is between the manager and the staff, to one side.
    assert!(asst.y > root.bottom() && asst.bottom() < kid.y);
    assert_eq!(
        laid.shapes
            .iter()
            .find(|s| s.node == Some(1) && s.primary)
            .unwrap()
            .label,
        "asst1"
    );
}

#[test]
fn venn_and_pyramid_stack_their_parts() {
    check(Kind::Venn, &[1, 1, 1], 3, true);
    let levels = check(Kind::Pyramid, &[1, 1, 1], 3, false);
    // Each level is wider than the one above it.
    assert!(
        levels
            .windows(2)
            .all(|p| p[1].w > p[0].w && p[1].y > p[0].y)
    );
}

#[test]
fn long_text_shrinks_every_node_together() {
    let d = diagram(&[1, 1, 1]);
    let short = lay_out(
        Kind::Process,
        &d,
        640.0,
        426.7,
        &mut Approx { chars: vec![4; 3] },
    );
    let long = lay_out(
        Kind::Process,
        &d,
        640.0,
        426.7,
        &mut Approx {
            chars: vec![4, 80, 4],
        },
    );
    assert!(long.sizes.primary < short.sizes.primary);
}
