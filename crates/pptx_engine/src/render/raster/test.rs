use super::*;
use crate::model::color::Rgba;
use crate::path::{Path, Rect};

fn px(r: &Raster, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * r.width + x) * 4) as usize;
    [r.pixels[i], r.pixels[i + 1], r.pixels[i + 2], r.pixels[i + 3]]
}

#[test]
fn fills_and_strokes() {
    let nodes = vec![
        Node::Fill { path: Path::rect(Rect::from_xywh(0.0, 0.0, 10.0, 10.0)), paint: Paint::Solid(Rgba::from_u8(255, 0, 0)), even_odd: false },
        Node::Stroke {
            path: Path::rect(Rect::from_xywh(2.0, 2.0, 6.0, 6.0)),
            paint: Paint::Solid(Rgba::from_u8(0, 0, 255)),
            stroke: Stroke { width: 1.0, cap: LineCap::Butt, join: LineJoin::Miter, miter_limit: 4.0, dash: None },
        },
    ];
    let r = rasterize(&nodes, 30, 30, 2.0);
    assert_eq!(px(&r, 1, 1), [255, 0, 0, 255]);
    assert_eq!(px(&r, 4, 10)[2], 255, "stroke at x=2pt");
    assert_eq!(px(&r, 25, 25), [0, 0, 0, 0]);
}

#[test]
fn group_opacity_and_shadow() {
    let child = Node::Fill { path: Path::rect(Rect::from_xywh(5.0, 5.0, 10.0, 10.0)), paint: Paint::Solid(Rgba::WHITE), even_odd: false };
    let g = Group {
        children: vec![child],
        opacity: 0.5,
        clip: None,
        effects: vec![Effect::OuterShadow {
            color: Rgba::BLACK,
            blur: 0.0,
            offset: crate::path::Point::new(3.0, 3.0),
            transform: crate::path::Affine::IDENTITY,
        }],
    };
    let r = rasterize(&[g.into_node()], 30, 30, 1.0);
    let inside = px(&r, 10, 10);
    assert!((i32::from(inside[3]) - 128).abs() <= 2, "{inside:?}");
    let shadow = px(&r, 17, 17);
    assert!(shadow[3] > 100 && shadow[0] < 10, "{shadow:?}");
}

#[test]
fn blur_spreads_alpha() {
    let mut a = vec![0u8; 21 * 21];
    a[10 * 21 + 10] = 255;
    blur_alpha(&mut a, 21, 21, 6.0);
    assert!(a[10 * 21 + 10] < 255);
    assert!(a[10 * 21 + 12] > 0);
    let total: u32 = a.iter().map(|&v| u32::from(v)).sum();
    assert!(total > 150 && total < 300, "mass roughly preserved: {total}");
}


#[test]
fn hostile_coordinates_are_ignored_or_clamped() {
    use crate::path::Point;
    let solid = Paint::Solid(Rgba { r: 1.0, g: 0.0, b: 0.0, a: 1.0 });
    let mut huge = Path::new();
    huge.move_to(Point::new(-1.0e12, -1.0e12));
    huge.line_to(Point::new(1.0e12, -1.0e12));
    huge.line_to(Point::new(1.0e12, 1.0e12));
    huge.close();
    let mut nan = Path::new();
    nan.move_to(Point::new(f32::NAN, 0.0));
    nan.line_to(Point::new(10.0, 10.0));
    nan.line_to(Point::new(0.0, 10.0));
    nan.close();
    let nodes = vec![
        Node::Fill { path: huge, paint: solid.clone(), even_odd: false },
        Node::Fill { path: nan, paint: solid, even_odd: false },
    ];
    let r = rasterize(&nodes, 40, 40, 2.0);
    // The clamped triangle still covers the canvas's upper-right half.
    assert_eq!(px(&r, 35, 5)[0], 255);
}
