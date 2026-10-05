use super::*;
use crate::edit::{History, NewNode, Op, Position};
use crate::geom::Point;
use crate::model::{Color, Gradient, GradientStop};
use crate::testing::{draw, pixel};

fn with(node: NewNode) -> Document {
    let mut d = crate::save::blank(100.0, 100.0);
    History::new()
        .apply(
            &mut d,
            &[Op::Create {
                node,
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("applies");
    d
}

#[test]
fn draws_fills_strokes_and_artboards() {
    let d = with(NewNode::Rect {
        rect: Rect::from_xywh(10.0, 10.0, 30.0, 30.0),
        radius: 0.0,
        fill: Some(Paint::Solid {
            color: Color::Rgb {
                r: 1.0,
                g: 0.0,
                b: 0.0,
            },
        }),
        stroke: Some(crate::model::Stroke::solid(Color::BLACK, 4.0)),
    });
    let img = draw(&d);
    assert_eq!(pixel(&img, 25, 25), [255, 0, 0, 255]);
    assert_eq!(pixel(&img, 10, 25), [0, 0, 0, 255]);
    assert_eq!(pixel(&img, 80, 80), [255, 255, 255, 255]);
}

#[test]
fn draws_gradients() {
    let d = with(NewNode::Rect {
        rect: Rect::from_xywh(0.0, 0.0, 100.0, 100.0),
        radius: 0.0,
        fill: Some(Paint::Gradient {
            gradient: Gradient {
                transform: crate::geom::Affine::IDENTITY,
                radial: false,
                start: Point::new(0.0, 0.0),
                end: Point::new(100.0, 0.0),
                start_radius: 0.0,
                end_radius: 0.0,
                stops: vec![
                    GradientStop {
                        offset: 0.0,
                        color: Color::BLACK,
                        opacity: 1.0,
                    },
                    GradientStop {
                        offset: 1.0,
                        color: Color::Gray { g: 1.0 },
                        opacity: 1.0,
                    },
                ],
                extend: [true, true],
            },
        }),
        stroke: None,
    });
    let img = draw(&d);
    let mid = pixel(&img, 50, 50)[0];
    assert!((i32::from(mid) - 128).abs() < 6, "{mid}");
    assert!(pixel(&img, 5, 50)[0] < 20);
    assert!(pixel(&img, 95, 50)[0] > 235);
}

#[test]
fn groups_clip_and_fade() {
    let mut d = crate::save::blank(100.0, 100.0);
    let mut h = History::new();
    let fill = |r, g, b| {
        Some(Paint::Solid {
            color: Color::Rgb { r, g, b },
        })
    };
    let a = h
        .apply(
            &mut d,
            &[Op::Create {
                node: NewNode::Rect {
                    rect: Rect::from_xywh(0.0, 0.0, 100.0, 100.0),
                    radius: 0.0,
                    fill: fill(0.0, 0.0, 1.0),
                    stroke: None,
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("applies")
        .created[0];
    let clip = h
        .apply(
            &mut d,
            &[Op::Create {
                node: NewNode::Rect {
                    rect: Rect::from_xywh(0.0, 0.0, 50.0, 50.0),
                    radius: 0.0,
                    fill: None,
                    stroke: None,
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("applies")
        .created[0];
    h.apply(&mut d, &[Op::MakeClip { ids: vec![a, clip] }], None)
        .expect("clips");
    let g = d.node(d.layers[0]).children[0];
    let gid = d.node(g).id;
    h.apply(
        &mut d,
        &[Op::SetNode {
            ids: vec![gid],
            patch: crate::edit::NodePatch {
                opacity: Some(0.5),
                ..Default::default()
            },
        }],
        None,
    )
    .expect("fades");
    let img = draw(&d);
    let inside = pixel(&img, 25, 25);
    assert!(
        (i32::from(inside[0]) - 128).abs() < 3 && inside[2] == 255,
        "{inside:?}"
    );
    assert_eq!(pixel(&img, 75, 75), [255, 255, 255, 255]);
}

#[test]
fn outline_mode_and_views() {
    let d = with(NewNode::Ellipse {
        rect: Rect::from_xywh(20.0, 20.0, 60.0, 60.0),
        fill: Some(Paint::Solid {
            color: Color::Gray { g: 0.5 },
        }),
        stroke: None,
    });
    let view = View {
        x: 0.0,
        y: 0.0,
        scale: 2.0,
        width: 200,
        height: 200,
    };
    let rgba = Renderer::new().render(
        &d,
        &view,
        &Options {
            artboards: false,
            outline: true,
        },
    );
    // Inside is empty in outline mode; the edge is drawn.
    let at = |x: usize, y: usize| rgba[(y * 200 + x) * 4 + 3];
    assert_eq!(at(100, 100), 0);
    assert!(at(40, 100) > 0);
}
