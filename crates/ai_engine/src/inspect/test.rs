use super::*;
use crate::edit::{History, NewNode, Op, Position};
use crate::model::{Color, Paint};

fn doc_with_shapes() -> (Document, u32, u32, u32) {
    let mut d = crate::save::blank(400.0, 300.0);
    let mut h = History::new();
    let fill = Some(Paint::Solid {
        color: Color::BLACK,
    });
    let mut make = |node| {
        h.apply(
            &mut d,
            &[Op::Create {
                node,
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("applies")
        .created[0]
    };
    let square = make(NewNode::Rect {
        rect: Rect::from_xywh(10.0, 10.0, 100.0, 100.0),
        radius: 0.0,
        fill: fill.clone(),
        stroke: None,
    });
    let ring = make(NewNode::Ellipse {
        rect: Rect::from_xywh(200.0, 10.0, 100.0, 100.0),
        fill: None,
        stroke: Some(crate::model::Stroke::solid(Color::BLACK, 4.0)),
    });
    let over = make(NewNode::Rect {
        rect: Rect::from_xywh(50.0, 50.0, 20.0, 20.0),
        radius: 0.0,
        fill,
        stroke: None,
    });
    (d, square, ring, over)
}

#[test]
fn hits_the_topmost_painted_object() {
    let (mut d, square, ring, over) = doc_with_shapes();
    assert_eq!(hit_test(&d, 60.0, 60.0, 1.0, false), Some(over));
    assert_eq!(hit_test(&d, 20.0, 20.0, 1.0, false), Some(square));
    // An unfilled ring: its stroke, not its middle.
    assert_eq!(hit_test(&d, 250.0, 60.0, 1.0, false), None);
    assert_eq!(hit_test(&d, 201.0, 60.0, 1.0, false), Some(ring));
    assert_eq!(hit_test(&d, 150.0, 200.0, 1.0, false), None);
    // Grouped: the group, or the object itself when deep.
    History::new()
        .apply(
            &mut d,
            &[Op::Group {
                ids: vec![square, over],
            }],
            None,
        )
        .expect("groups");
    let group = rows(&d)[1].id;
    assert_eq!(hit_test(&d, 20.0, 20.0, 1.0, false), Some(group));
    assert_eq!(hit_test(&d, 20.0, 20.0, 1.0, true), Some(square));
    // Locked and hidden objects are passed over.
    d.node_mut(d.find(group).expect("group")).locked = true;
    assert_eq!(hit_test(&d, 20.0, 20.0, 1.0, false), None);
}

#[test]
fn rows_list_the_tree_top_down() {
    let (d, square, ring, over) = doc_with_shapes();
    let r = rows(&d);
    let ids: Vec<u32> = r.iter().map(|row| row.id).collect();
    assert_eq!(ids[1..], [over, ring, square]);
    assert_eq!(r[0].kind, "layer");
    assert_eq!(r[0].children, 3);
    assert_eq!(r[1].depth, 1);
    assert_eq!(r[1].name, "Rectangle");
}

#[test]
fn marquees_and_bounds() {
    let (d, square, ring, over) = doc_with_shapes();
    let mut hit = in_rect(&d, Rect::from_xywh(0.0, 0.0, 60.0, 60.0), false);
    hit.sort();
    let mut want = vec![square, over];
    want.sort();
    assert_eq!(hit, want);
    assert_eq!(
        bounds(&d, &[square, ring]),
        Some(Rect::new(10.0, 8.0, 302.0, 112.0))
    );
    let i = info(&d, ring).expect("info");
    assert_eq!(i.kind, "path");
    assert!(i.fill.is_none());
    assert_eq!(i.stroke.map(|s| s.width), Some(4.0));
}

#[test]
fn shape_bounds_leave_strokes_out() {
    let (mut d, square, ring, over) = doc_with_shapes();
    let ring_info = info(&d, ring).expect("info");
    // The 4-wide stroke reaches 2 beyond the outline.
    assert_eq!(ring_info.bounds, Some(Rect::new(198.0, 8.0, 302.0, 112.0)));
    assert_eq!(
        ring_info.shape_bounds,
        Some(Rect::new(200.0, 10.0, 300.0, 110.0))
    );
    History::new()
        .apply(
            &mut d,
            &[Op::Group {
                ids: vec![square, ring, over],
            }],
            None,
        )
        .expect("groups");
    let group = rows(&d)[1].id;
    let g = info(&d, group).expect("info");
    assert_eq!(g.shape_bounds, Some(Rect::new(10.0, 10.0, 300.0, 110.0)));
    assert_eq!(g.bounds, Some(Rect::new(10.0, 8.0, 302.0, 112.0)));
}

#[test]
fn images_encode_and_decode() {
    let rgba: Vec<u8> = (0..6)
        .flat_map(|k| [k * 40, 255 - k * 40, 7, 255])
        .collect();
    let png = encode_png(3, 2, &rgba).expect("encodes");
    assert_eq!(decode_image(&png), Some((3, 2, rgba)));
}
