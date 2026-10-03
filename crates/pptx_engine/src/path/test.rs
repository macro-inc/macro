use super::*;

fn close(a: Point, b: Point) -> bool {
    (a.x - b.x).abs() < 1e-3 && (a.y - b.y).abs() < 1e-3
}

#[test]
fn affine_composition_order() {
    let t = Affine::translate(10.0, 0.0);
    let s = Affine::scale(2.0, 2.0);
    // pre_concat: scale first, then translate.
    let m = t.pre_concat(&s);
    assert!(close(m.apply(Point::new(1.0, 1.0)), Point::new(12.0, 2.0)));
    let m = t.post_concat(&s);
    assert!(close(m.apply(Point::new(1.0, 1.0)), Point::new(22.0, 2.0)));
    let r = Affine::rotate(90.0);
    assert!(close(r.apply(Point::new(1.0, 0.0)), Point::new(0.0, 1.0)), "clockwise on screen");
    let inv = m.invert().unwrap();
    assert!(close(inv.apply(m.apply(Point::new(3.0, -4.0))), Point::new(3.0, -4.0)));
}

#[test]
fn ellipse_bounds_and_containment() {
    let p = Path::ellipse(Rect::from_xywh(0.0, 0.0, 100.0, 50.0));
    let b = p.bounds().unwrap();
    assert!((b.x - 0.0).abs() < 1e-3 && (b.right() - 100.0).abs() < 1e-3);
    assert!(p.contains(Point::new(50.0, 25.0), 0.5));
    assert!(!p.contains(Point::new(2.0, 2.0), 0.5));
}

#[test]
fn ooxml_arc_quarter_circle() {
    // Start at the top of a circle centered at (50, 50) and sweep 90° clockwise.
    let mut p = Path::new();
    p.move_to(Point::new(50.0, 0.0));
    p.arc_to_ooxml(50.0, 50.0, 270.0, 90.0);
    assert!(close(p.current(), Point::new(100.0, 50.0)), "{:?}", p.current());
    // Elliptical arc honours visual angles: 45° on a wide ellipse.
    let mut q = Path::new();
    q.move_to(Point::new(200.0, 50.0)); // rightmost point of ellipse centered (100, 50), rx=100, ry=50
    q.arc_to_ooxml(100.0, 50.0, 0.0, 45.0);
    let end = q.current();
    let (dx, dy) = (end.x - 100.0, end.y - 50.0);
    assert!((dy.atan2(dx).to_degrees() - 45.0).abs() < 0.05, "visual angle {:?}", end);
    assert!(((dx / 100.0).powi(2) + (dy / 50.0).powi(2) - 1.0).abs() < 1e-3, "on the ellipse");
}

#[test]
fn flatten_closes_subpaths() {
    let p = Path::rect(Rect::from_xywh(0.0, 0.0, 10.0, 10.0));
    let polys = p.flatten(0.1);
    assert_eq!(polys.len(), 1);
    assert_eq!(polys[0].first(), polys[0].last());
}
