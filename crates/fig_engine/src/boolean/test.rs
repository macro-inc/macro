use super::*;
use crate::geometry::ParsedPath;
use crate::model::{Vec2, WindingRule};

fn rect(x: f32, y: f32, w: f32, h: f32) -> Operand {
    let r = tiny_skia::Rect::from_xywh(x, y, w, h).unwrap();
    vec![(PathBuilder::from_rect(r), FillRule::Winding)]
}

fn circle(cx: f32, cy: f32, r: f32) -> Operand {
    let rect = tiny_skia::Rect::from_xywh(cx - r, cy - r, 2.0 * r, 2.0 * r).unwrap();
    vec![(PathBuilder::from_oval(rect).unwrap(), FillRule::Winding)]
}

fn inside(path: &Path, x: f64, y: f64) -> bool {
    ParsedPath { path: path.clone() }.contains(Vec2::new(x, y), WindingRule::NonZero)
}

/// Area by sampling cell centers.
fn area(path: &Path, step: f64) -> f64 {
    let b = path.bounds();
    let mut count = 0usize;
    let mut y = f64::from(b.y()) + step / 2.0;
    while y < f64::from(b.bottom()) {
        let mut x = f64::from(b.x()) + step / 2.0;
        while x < f64::from(b.right()) {
            if inside(path, x, y) {
                count += 1;
            }
            x += step;
        }
        y += step;
    }
    count as f64 * step * step
}

fn squares(op: BoolOp) -> Path {
    combine(
        op,
        &[rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 5.0, 10.0, 10.0)],
    )
    .unwrap()
}

#[test]
fn unions_overlapping_shapes() {
    let p = squares(BoolOp::Union);
    assert!((area(&p, 0.25) - 175.0).abs() < 1.0);
    assert!(inside(&p, 2.0, 2.0) && inside(&p, 12.0, 12.0) && inside(&p, 7.0, 7.0));
    assert!(!inside(&p, 2.0, 12.0) && !inside(&p, 12.0, 2.0));
}

#[test]
fn subtracts_the_upper_shapes_from_the_bottom_one() {
    let p = squares(BoolOp::Subtract);
    assert!((area(&p, 0.25) - 75.0).abs() < 1.0);
    assert!(inside(&p, 2.0, 2.0));
    assert!(!inside(&p, 7.0, 7.0) && !inside(&p, 12.0, 12.0));
}

#[test]
fn intersects_and_excludes() {
    let p = squares(BoolOp::Intersect);
    assert!((area(&p, 0.25) - 25.0).abs() < 1.0);
    assert!(inside(&p, 7.0, 7.0) && !inside(&p, 2.0, 2.0));
    let p = squares(BoolOp::Exclude);
    assert!((area(&p, 0.25) - 150.0).abs() < 1.0);
    assert!(!inside(&p, 7.0, 7.0) && inside(&p, 2.0, 2.0) && inside(&p, 12.0, 12.0));
}

#[test]
fn merges_shared_edges_into_one_outline() {
    let p = combine(
        BoolOp::Union,
        &[rect(0.0, 0.0, 10.0, 10.0), rect(10.0, 0.0, 10.0, 10.0)],
    )
    .unwrap();
    assert!((area(&p, 0.25) - 200.0).abs() < 1.0);
    let lines = p
        .segments()
        .filter(|s| matches!(s, PathSegment::LineTo(_)))
        .count();
    assert_eq!(lines, 4, "one rectangle, collinear pieces merged");
}

#[test]
fn keeps_curves_as_curves() {
    let p = combine(
        BoolOp::Union,
        &[circle(10.0, 10.0, 10.0), circle(25.0, 10.0, 10.0)],
    )
    .unwrap();
    let cubics = p
        .segments()
        .filter(|s| matches!(s, PathSegment::CubicTo(..)))
        .count();
    assert!(cubics <= 16, "{cubics} curves");
    // Two circles of radius 10 whose centers are 15 apart.
    let lens = 2.0 * 100.0 * (0.75f64).acos() - 7.5 * (100.0f64 - 56.25).sqrt() * 2.0;
    let expected = 2.0 * std::f64::consts::PI * 100.0 - lens;
    assert!(
        (area(&p, 0.1) - expected).abs() < expected * 0.01,
        "{} vs {expected}",
        area(&p, 0.1)
    );
}

#[test]
fn follows_each_paths_winding_rule() {
    // A frame-shaped path filled even-odd, unioned with a square in its hole.
    let mut pb = PathBuilder::new();
    pb.push_rect(tiny_skia::Rect::from_xywh(0.0, 0.0, 30.0, 30.0).unwrap());
    pb.push_rect(tiny_skia::Rect::from_xywh(10.0, 10.0, 10.0, 10.0).unwrap());
    let ring = vec![(pb.finish().unwrap(), FillRule::EvenOdd)];
    let p = combine(BoolOp::Union, &[ring.clone()]).unwrap();
    assert!(!inside(&p, 15.0, 15.0) && inside(&p, 5.0, 5.0));
    let p = combine(BoolOp::Union, &[ring, rect(12.0, 12.0, 4.0, 4.0)]).unwrap();
    assert!(inside(&p, 14.0, 14.0) && !inside(&p, 18.0, 18.0));
}

#[test]
fn empty_results_are_none() {
    assert!(
        combine(
            BoolOp::Subtract,
            &[rect(0.0, 0.0, 10.0, 10.0), rect(0.0, 0.0, 10.0, 10.0)]
        )
        .is_none()
    );
    assert!(
        combine(
            BoolOp::Intersect,
            &[rect(0.0, 0.0, 10.0, 10.0), rect(20.0, 0.0, 10.0, 10.0)]
        )
        .is_none()
    );
}

#[test]
fn parses_figma_names() {
    assert_eq!(BoolOp::parse("XOR"), Some(BoolOp::Exclude));
    assert_eq!(BoolOp::Exclude.figma_name(), "XOR");
    assert_eq!(BoolOp::parse("SUBTRACT"), Some(BoolOp::Subtract));
}
