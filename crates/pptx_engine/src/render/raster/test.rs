use super::*;
use crate::model::color::Rgba;
use crate::path::{Path, Rect};

fn px(r: &Raster, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * r.width + x) * 4) as usize;
    [
        r.pixels[i],
        r.pixels[i + 1],
        r.pixels[i + 2],
        r.pixels[i + 3],
    ]
}

#[test]
fn fills_and_strokes() {
    let nodes = vec![
        Node::Fill {
            path: Path::rect(Rect::from_xywh(0.0, 0.0, 10.0, 10.0)),
            paint: Paint::Solid(Rgba::from_u8(255, 0, 0)),
            even_odd: false,
        },
        Node::Stroke {
            path: Path::rect(Rect::from_xywh(2.0, 2.0, 6.0, 6.0)),
            paint: Paint::Solid(Rgba::from_u8(0, 0, 255)),
            stroke: Stroke {
                width: 1.0,
                cap: LineCap::Butt,
                join: LineJoin::Miter,
                miter_limit: 4.0,
                dash: None,
            },
        },
    ];
    let r = rasterize(&nodes, 30, 30, 2.0);
    assert_eq!(px(&r, 1, 1), [255, 0, 0, 255]);
    assert_eq!(px(&r, 4, 10)[2], 255, "stroke at x=2pt");
    assert_eq!(px(&r, 25, 25), [0, 0, 0, 0]);
}

#[test]
fn group_opacity_and_shadow() {
    let child = Node::Fill {
        path: Path::rect(Rect::from_xywh(5.0, 5.0, 10.0, 10.0)),
        paint: Paint::Solid(Rgba::WHITE),
        even_odd: false,
    };
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
    assert!(
        total > 150 && total < 300,
        "mass roughly preserved: {total}"
    );
}

#[test]
fn hostile_coordinates_are_ignored_or_clamped() {
    use crate::path::Point;
    let solid = Paint::Solid(Rgba {
        r: 1.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    });
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
        Node::Fill {
            path: huge,
            paint: solid.clone(),
            even_odd: false,
        },
        Node::Fill {
            path: nan,
            paint: solid,
            even_odd: false,
        },
    ];
    let r = rasterize(&nodes, 40, 40, 2.0);
    // The clamped triangle still covers the canvas's upper-right half.
    assert_eq!(px(&r, 35, 5)[0], 255);
}

/// A white 10 pt square at (5, 5) with layer effects, at one pixel per point.
fn square_with(effects: Vec<Effect>) -> Raster {
    let square = Node::Fill {
        path: Path::rect(Rect::from_xywh(5.0, 5.0, 10.0, 10.0)),
        paint: Paint::Solid(Rgba::WHITE),
        even_odd: false,
    };
    let g = Group {
        children: vec![square],
        opacity: 1.0,
        clip: None,
        effects,
    };
    rasterize(&[g.into_node()], 40, 40, 1.0)
}

#[test]
fn shadows_and_glows_are_cast_by_the_content_alone() {
    use crate::path::{Affine, Point};
    let outer = Effect::OuterShadow {
        color: Rgba::BLACK.with_alpha_mul(0.5),
        blur: 0.0,
        offset: Point::new(10.0, 0.0),
        transform: Affine::IDENTITY,
    };
    // Offset left: the inner shadow shades the square's right edge.
    let inner = Effect::InnerShadow {
        color: Rgba::BLACK,
        blur: 0.0,
        offset: Point::new(-3.0, 0.0),
    };
    let glow = Effect::Glow {
        color: Rgba::from_u8(0, 255, 0),
        radius: 2.0,
    };
    let alone = square_with(vec![outer.clone()]);
    let both = square_with(vec![outer.clone(), inner]);
    assert_eq!(px(&both, 13, 10), [0, 0, 0, 255], "shaded inside");
    assert_eq!(
        px(&both, 22, 10),
        px(&alone, 22, 10),
        "the outer shadow is not shaded"
    );
    // The shadow (x 15-25) is cast by the square, not by its glow.
    let glowing = square_with(vec![glow, outer]);
    assert_eq!(px(&glowing, 26, 10)[3], 0);
    assert!(px(&glowing, 22, 10)[3] > 100);
}

#[test]
fn reflections_are_blurred() {
    let reflection = |blur: f32| Effect::Reflection {
        axis: 15.0,
        dist: 0.0,
        start_alpha: 1.0,
        end_alpha: 1.0,
        end_pos: 1.0,
        height: 10.0,
        blur,
    };
    let sharp = square_with(vec![reflection(0.0)]);
    assert_eq!(px(&sharp, 10, 18), [255, 255, 255, 255]);
    assert_eq!(px(&sharp, 15, 18)[3], 0);
    let soft = square_with(vec![reflection(3.0)]);
    let edge = px(&soft, 15, 18);
    assert!(edge[3] > 0 && edge[3] < 255, "{edge:?}");
    assert!(edge[0] <= edge[3], "premultiplied: {edge:?}");
}
