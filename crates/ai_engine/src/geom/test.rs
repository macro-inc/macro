use super::*;

fn close(a: Point, b: Point) -> bool {
    a.distance(b) < 1e-9
}

#[test]
fn maps_compose_in_order() {
    let t = Affine::translate(10.0, 0.0);
    let s = Affine::scale(2.0, 2.0);
    // Scale, then translate.
    let m = s.followed_by(&t);
    assert!(close(m.apply(Point::new(1.0, 1.0)), Point::new(12.0, 2.0)));
    // Translate, then scale.
    let m = t.followed_by(&s);
    assert!(close(m.apply(Point::new(1.0, 1.0)), Point::new(22.0, 2.0)));
    let inv = m.invert().unwrap();
    assert!(close(
        inv.apply(Point::new(22.0, 2.0)),
        Point::new(1.0, 1.0)
    ));
    assert!(Affine::scale(0.0, 1.0).invert().is_none());
}

#[test]
fn rect_bounds_and_overlap() {
    let a = Rect::from_xywh(0.0, 0.0, 10.0, 10.0);
    let b = Rect::new(15.0, 15.0, 5.0, 5.0);
    assert_eq!(b, Rect::from_xywh(5.0, 5.0, 10.0, 10.0));
    assert_eq!(a.intersect(&b), Rect::from_xywh(5.0, 5.0, 5.0, 5.0));
    assert!(
        !a.intersect(&Rect::from_xywh(20.0, 20.0, 1.0, 1.0))
            .intersects(&a)
    );
    let r = a.transform(&Affine::rotate(std::f64::consts::FRAC_PI_4));
    assert!((r.width() - 200f64.sqrt()).abs() < 1e-9);
}

#[test]
fn curve_bounds_are_tight() {
    // A curve bulging to y = 7.5 at its middle.
    let path = PathData {
        segs: vec![
            Seg::Move {
                p: Point::new(0.0, 0.0),
            },
            Seg::Cubic {
                c1: Point::new(0.0, 10.0),
                c2: Point::new(10.0, 10.0),
                p: Point::new(10.0, 0.0),
            },
        ],
    };
    let b = path.bounds().unwrap();
    assert!((b.y1 - 7.5).abs() < 1e-9, "{b:?}");
    assert_eq!(path.control_bounds().unwrap().y1, 10.0);
}

#[test]
fn containment_and_distance() {
    let square = PathData::rect(Rect::from_xywh(0.0, 0.0, 10.0, 10.0));
    let polys = square.flatten(0.1);
    assert!(polygons_contain(&polys, Point::new(5.0, 5.0), false));
    assert!(!polygons_contain(&polys, Point::new(15.0, 5.0), false));
    assert!((distance_to_polylines(&polys, Point::new(5.0, -3.0)) - 3.0).abs() < 1e-9);
    // A square with a hole, even-odd.
    let mut donut = square.clone();
    donut
        .segs
        .extend(PathData::rect(Rect::from_xywh(3.0, 3.0, 4.0, 4.0)).segs);
    let polys = donut.flatten(0.1);
    assert!(!polygons_contain(&polys, Point::new(5.0, 5.0), true));
    assert!(polygons_contain(&polys, Point::new(1.0, 1.0), true));
}

#[test]
fn skia_round_trip_and_svg() {
    let path = PathData {
        segs: vec![
            Seg::Move {
                p: Point::new(1.0, 2.0),
            },
            Seg::Line {
                p: Point::new(3.0, 4.0),
            },
            Seg::Cubic {
                c1: Point::new(5.0, 6.0),
                c2: Point::new(7.0, 8.0),
                p: Point::new(9.5, 10.0),
            },
            Seg::Close,
        ],
    };
    let back = PathData::from_skia(&path.to_skia().unwrap());
    assert_eq!(back.segs.len(), path.segs.len());
    assert_eq!(path.to_svg(), "M1 2L3 4C5 6 7 8 9.5 10Z");
}
