use super::*;
use crate::edit::{History, NewNode, Op, Position};
use crate::geom::{Point, Rect};
use crate::model::{Color, Paint, TextAlign};

#[test]
fn outlines_and_text_name_what_is_there() {
    let mut d = crate::save::blank(300.0, 200.0);
    History::new()
        .apply(
            &mut d,
            &[
                Op::Create {
                    node: NewNode::Rect {
                        rect: Rect::from_xywh(10.0, 10.0, 50.0, 50.0),
                        radius: 0.0,
                        fill: Some(Paint::Solid {
                            color: Color::Rgb {
                                r: 1.0,
                                g: 0.0,
                                b: 0.0,
                            },
                        }),
                        stroke: None,
                    },
                    parent: None,
                    position: Position::Top,
                },
                Op::Create {
                    node: NewNode::Text {
                        at: Point::new(10.0, 100.0),
                        text: "Quarterly report".into(),
                        family: "Inter".into(),
                        style: "Bold".into(),
                        size: 24.0,
                        fill: Some(Paint::Solid {
                            color: Color::BLACK,
                        }),
                        width: None,
                        align: TextAlign::Left,
                    },
                    parent: None,
                    position: Position::Top,
                },
            ],
            None,
        )
        .expect("applies");
    let o = outline(&d, 10_000);
    assert!(o.contains("1 artboard"), "{o}");
    assert!(o.contains("[path] \"Rectangle\""), "{o}");
    assert!(o.contains("fill #ff0000"), "{o}");
    assert!(o.contains("Inter Bold 24pt"), "{o}");
    let t = text(&d);
    assert!(t.contains("Quarterly report"));
    assert!(t.contains("Layer 1"));
    assert!(outline(&d, 10).contains("more objects not shown"));
}
