use crate::build::node_bounds;
use crate::edit::{History, NewNode, Op, Position};
use crate::geom::Rect;
use crate::model::{Color, Document, Paint};

fn doc() -> Document {
    crate::save::blank(400.0, 300.0)
}

fn square(x: f64, y: f64) -> Op {
    Op::Create {
        node: NewNode::Rect {
            rect: Rect::from_xywh(x, y, 20.0, 20.0),
            radius: 0.0,
            fill: Some(Paint::Solid {
                color: Color::BLACK,
            }),
            stroke: None,
        },
        parent: None,
        position: Position::Top,
    }
}

/// Ids of the first layer's live children, bottom first.
fn layer_children(doc: &Document) -> Vec<u32> {
    doc.node(doc.layers[0])
        .children
        .iter()
        .filter(|&&c| !doc.node(c).removed)
        .map(|&c| doc.node(c).id)
        .collect()
}

#[test]
fn paste_copies_what_a_cut_deleted() {
    let mut d = doc();
    let mut h = History::new();
    let id = h
        .apply(&mut d, &[square(10.0, 10.0)], None)
        .expect("creates")
        .created[0];
    h.apply(&mut d, &[Op::Delete { ids: vec![id] }], None)
        .expect("deletes");
    assert!(!layer_children(&d).contains(&id));

    let pasted = h
        .apply(
            &mut d,
            &[Op::Paste {
                ids: vec![id],
                offset: Some([10.0, 10.0]),
                parent: None,
            }],
            None,
        )
        .expect("pastes");
    assert_eq!(pasted.created.len(), 1);
    let copy = d.find(pasted.created[0]).expect("the copy");
    assert!(!d.node(copy).removed);
    assert_eq!(
        node_bounds(&d, copy),
        Some(Rect::from_xywh(20.0, 20.0, 20.0, 20.0))
    );
    assert_eq!(layer_children(&d), vec![pasted.created[0]]);

    // Undo takes the copy away again.
    h.undo(&mut d);
    assert!(layer_children(&d).is_empty());
}

#[test]
fn paste_keeps_the_order_and_copies_groups_whole() {
    let mut d = doc();
    let mut h = History::new();
    let mut make = |d: &mut Document, op: Op| h.apply(d, &[op], None).expect("applies").created[0];
    let a = make(&mut d, square(0.0, 0.0));
    let b = make(&mut d, square(50.0, 0.0));
    let c = make(&mut d, square(100.0, 0.0));
    let group = make(&mut d, Op::Group { ids: vec![b, c] });
    let layer = d.node(d.layers[0]).id;
    let before = layer_children(&d);

    // The group and one of its children, a plain object, and a layer: the
    // child comes with its group, and layers are left out.
    let pasted = h
        .apply(
            &mut d,
            &[Op::Paste {
                ids: vec![a, group, b, layer],
                offset: None,
                parent: Some(layer),
            }],
            None,
        )
        .expect("pastes");
    let after = layer_children(&d);
    assert_eq!(after.len(), before.len() + 2);
    let (copy_a, copy_group) = (after[after.len() - 2], after[after.len() - 1]);
    assert!(pasted.created.contains(&copy_a) && pasted.created.contains(&copy_group));
    let find = |id: u32| d.find(id).expect("a node");
    assert_eq!(d.node(find(copy_group)).children.len(), 2);
    assert_eq!(node_bounds(&d, find(copy_a)), node_bounds(&d, find(a)));
}

#[test]
fn paste_parses_from_json() {
    let ops: Vec<Op> =
        serde_json::from_str(r#"[{"op":"paste","ids":[3,4],"offset":[10,10]}]"#).expect("parses");
    assert_eq!(
        ops,
        vec![Op::Paste {
            ids: vec![3, 4],
            offset: Some([10.0, 10.0]),
            parent: None,
        }]
    );
}
