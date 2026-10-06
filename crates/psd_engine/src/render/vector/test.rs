use super::*;
use crate::model::{Fill, Knot, Rgb};

/// A closed polygon subpath.
fn poly(points: &[(f64, f64)], op: PathOp) -> Subpath {
    Subpath {
        nonzero: false,
        joined: false,
        shape: 0,
        closed: true,
        op,
        knots: points.iter().map(|&(x, y)| Knot::corner(x, y)).collect(),
    }
}

fn rect_path(x: f64, y: f64, w: f64, h: f64, op: PathOp) -> Subpath {
    poly(&[(x, y), (x + w, y), (x + w, y + h), (x, y + h)], op)
}

fn mask(subpaths: Vec<Subpath>) -> VectorMask {
    VectorMask {
        subpaths,
        ..VectorMask::default()
    }
}

fn cov(m: &VectorMask, level: u8, rect: IRect) -> Plane {
    mask_coverage(&mut Cache::default(), m, level, rect)
}

#[test]
fn rectangles_cover_whole_and_half_pixels() {
    let m = mask(vec![rect_path(10.0, 10.0, 20.0, 10.0, PathOp::Combine)]);
    let rect = IRect::new(0, 0, 40, 30);
    let p = cov(&m, 0, rect);
    assert_eq!(p.get(10, 10), 1.0);
    assert_eq!(p.get(29, 19), 1.0);
    assert_eq!(p.get(9, 15), 0.0);
    assert_eq!(p.get(30, 15), 0.0);
    let half = mask(vec![rect_path(10.5, 10.0, 20.0, 10.0, PathOp::Combine)]);
    let h = cov(&half, 0, rect);
    assert!((h.get(10, 15) - 0.5).abs() < 0.02, "{}", h.get(10, 15));
    // At level 1 the canvas halves.
    let l1 = cov(&m, 1, IRect::new(0, 0, 20, 15));
    assert_eq!(l1.get(5, 5), 1.0);
    assert_eq!(l1.get(14, 9), 1.0);
    assert_eq!(l1.get(15, 9), 0.0);
}

#[test]
fn path_operations_combine_runs() {
    let rect = IRect::new(0, 0, 40, 40);
    let outer = rect_path(5.0, 5.0, 30.0, 30.0, PathOp::Combine);
    let inner = |op| rect_path(15.0, 15.0, 10.0, 10.0, op);
    let sub = cov(&mask(vec![outer.clone(), inner(PathOp::Subtract)]), 0, rect);
    assert_eq!((sub.get(10, 10), sub.get(20, 20)), (1.0, 0.0));
    let int = cov(
        &mask(vec![outer.clone(), inner(PathOp::Intersect)]),
        0,
        rect,
    );
    assert_eq!((int.get(10, 10), int.get(20, 20)), (0.0, 1.0));
    let exc = cov(
        &mask(vec![
            outer.clone(),
            rect_path(20.0, 20.0, 20.0, 20.0, PathOp::Exclude),
        ]),
        0,
        rect,
    );
    assert_eq!(
        (exc.get(10, 10), exc.get(25, 25), exc.get(37, 37)),
        (1.0, 0.0, 1.0)
    );
    // A hole joined to its outline's shape stays open; a shape of its own
    // is added.
    let mut hole = poly(
        &[(15.0, 15.0), (15.0, 25.0), (25.0, 25.0), (25.0, 15.0)],
        PathOp::Combine,
    );
    let separate = cov(&mask(vec![outer.clone(), hole.clone()]), 0, rect);
    assert_eq!((separate.get(10, 10), separate.get(20, 20)), (1.0, 1.0));
    hole.joined = true;
    let donut = cov(&mask(vec![outer.clone(), hole.clone()]), 0, rect);
    assert_eq!((donut.get(10, 10), donut.get(20, 20)), (1.0, 0.0));
    // Even-odd leaves the hole open however it is wound; nonzero only when
    // it is wound against the outline.
    let mut same_way = rect_path(15.0, 15.0, 10.0, 10.0, PathOp::Combine);
    same_way.joined = true;
    let mut outline = outer.clone();
    let even_odd = cov(&mask(vec![outline.clone(), same_way.clone()]), 0, rect);
    assert_eq!(even_odd.get(20, 20), 0.0);
    outline.nonzero = true;
    let nonzero = cov(&mask(vec![outline, same_way]), 0, rect);
    assert_eq!(nonzero.get(20, 20), 1.0);
    // Overlapping shapes combined in one run stay solid.
    let both = cov(&mask(vec![outer, inner(PathOp::Combine)]), 0, rect);
    assert_eq!(both.get(20, 20), 1.0);
}

#[test]
fn inversion_and_starting_full() {
    let rect = IRect::new(0, 0, 20, 20);
    let mut m = mask(vec![rect_path(5.0, 5.0, 10.0, 10.0, PathOp::Combine)]);
    m.invert = true;
    let p = cov(&m, 0, rect);
    assert_eq!((p.get(0, 0), p.get(10, 10)), (1.0, 0.0));
    // A first subtraction cuts from everything.
    let s = mask(vec![rect_path(5.0, 5.0, 10.0, 10.0, PathOp::Subtract)]);
    let p = cov(&s, 0, rect);
    assert_eq!((p.get(0, 0), p.get(10, 10)), (1.0, 0.0));
    assert_eq!(mask_bounds(&s), None);
    // An empty mask that starts full reveals everything.
    let all = VectorMask {
        fill_all: true,
        ..VectorMask::default()
    };
    assert!(cov(&all, 0, rect).v.iter().all(|&v| v == 1.0));
    // An empty one hides everything.
    assert!(
        cov(&VectorMask::default(), 0, rect)
            .v
            .iter()
            .all(|&v| v == 0.0)
    );
}

#[test]
fn curves_are_filled_smoothly() {
    // A circle of radius 10 from four cubic arcs.
    let k = 0.552_284_75 * 10.0;
    let (cx, cy) = (20.0, 20.0);
    let knot = |ax: f64, ay: f64, bx: f64, by: f64, fx: f64, fy: f64| Knot {
        before: (bx, by),
        anchor: (ax, ay),
        after: (fx, fy),
        linked: true,
    };
    let circle = Subpath {
        nonzero: false,
        joined: false,
        shape: 0,
        closed: true,
        op: PathOp::Combine,
        knots: vec![
            knot(cx + 10.0, cy, cx + 10.0, cy - k, cx + 10.0, cy + k),
            knot(cx, cy + 10.0, cx + k, cy + 10.0, cx - k, cy + 10.0),
            knot(cx - 10.0, cy, cx - 10.0, cy + k, cx - 10.0, cy - k),
            knot(cx, cy - 10.0, cx - k, cy - 10.0, cx + k, cy - 10.0),
        ],
    };
    let p = cov(&mask(vec![circle]), 0, IRect::new(0, 0, 40, 40));
    let area: f32 = p.v.iter().sum();
    let expected = std::f32::consts::PI * 100.0;
    assert!((area - expected).abs() < 2.0, "{area} vs {expected}");
    assert_eq!(p.get(20, 20), 1.0);
    assert_eq!(p.get(5, 5), 0.0);
}

fn stroke(width: f32, align: StrokeAlign) -> VectorStroke {
    VectorStroke {
        enabled: true,
        fill_enabled: true,
        width,
        align,
        cap: LineCap::Butt,
        join: LineJoin::Miter,
        miter_limit: 4.0,
        dashes: Vec::new(),
        dash_offset: 0.0,
        opacity: 1.0,
        blend: crate::model::BlendMode::Normal,
        fill: Fill::Solid { color: Rgb::BLACK },
    }
}

#[test]
fn strokes_sit_on_their_alignment() {
    let m = mask(vec![rect_path(10.0, 10.0, 20.0, 20.0, PathOp::Combine)]);
    let rect = IRect::new(0, 0, 40, 40);
    let row = |s: &VectorStroke| {
        let p = stroke_coverage(&mut Cache::default(), &m, s, 0, rect);
        (0..40).map(|x| p.get(x, 20)).collect::<Vec<f32>>()
    };
    let center = row(&stroke(4.0, StrokeAlign::Center));
    assert_eq!(&center[7..14], &[0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    let inside = row(&stroke(4.0, StrokeAlign::Inside));
    assert_eq!(&inside[8..16], &[0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    let outside = row(&stroke(4.0, StrokeAlign::Outside));
    assert_eq!(&outside[5..12], &[0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    // Dashes leave gaps along the top edge.
    let mut dashed = stroke(2.0, StrokeAlign::Center);
    dashed.dashes = vec![2.0, 2.0];
    let p = stroke_coverage(&mut Cache::default(), &m, &dashed, 0, rect);
    let top: Vec<f32> = (10..30).map(|x| p.get(x, 10)).collect();
    assert!(
        top.iter().any(|&v| v > 0.9) && top.iter().any(|&v| v < 0.1),
        "{top:?}"
    );
    assert!(stroke_reach(&stroke(4.0, StrokeAlign::Outside)) >= 4);
}

#[test]
fn absurd_strokes_stay_finite() {
    let m = mask(vec![rect_path(10.0, 10.0, 20.0, 20.0, PathOp::Combine)]);
    let rect = IRect::new(0, 0, 40, 40);
    let mut s = stroke(f32::INFINITY, StrokeAlign::Outside);
    s.miter_limit = f32::INFINITY;
    let reach = stroke_reach(&s);
    assert!(reach > 30000 && reach < i32::MAX / 4, "{reach}");
    let p = stroke_coverage(&mut Cache::default(), &m, &s, 0, rect);
    assert_eq!((p.get(0, 0), p.get(20, 20)), (1.0, 0.0));
    s.width = f32::NAN;
    s.miter_limit = f32::NAN;
    assert_eq!(stroke_reach(&s), 2);
    let p = stroke_coverage(&mut Cache::default(), &m, &s, 0, rect);
    assert!(p.v.iter().all(|&v| v == 0.0));
    // Dashes too fine to draw leave the stroke out.
    let mut fine = stroke(2.0, StrokeAlign::Center);
    fine.dashes = vec![1e-9, 1e-9];
    let p = stroke_coverage(&mut Cache::default(), &m, &fine, 0, rect);
    assert!(p.v.iter().all(|&v| v == 0.0));
}

#[test]
fn bounds_cover_points_and_handles() {
    let m = mask(vec![rect_path(10.5, 20.0, 5.0, 5.0, PathOp::Combine)]);
    let b = mask_bounds(&m).unwrap();
    assert!(b.contains_rect(&IRect::new(10, 20, 6, 5)), "{b:?}");
    assert_eq!(path_bounds(&[]), None);
}
