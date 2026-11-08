use super::*;
use crate::geom::Point;
use crate::model::{Color, NodeKind};

fn doc() -> Document {
    crate::save::blank(400.0, 300.0)
}

fn rect(x: f64, y: f64) -> Op {
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

fn layer_children(doc: &Document) -> Vec<u32> {
    doc.node(doc.layers[0])
        .children
        .iter()
        .map(|&c| doc.node(c).id)
        .collect()
}

#[test]
fn ops_parse_from_json() {
    let ops: Vec<Op> = serde_json::from_str(
        r#"[
          {"op":"create","node":{"type":"rect","rect":{"x0":0,"y0":0,"x1":10,"y1":10},"fill":null,"stroke":null}},
          {"op":"setNode","ids":[3],"opacity":0.5,"blend":"multiply"},
          {"op":"transform","ids":[3],"matrix":[1,0,0,1,5,5]},
          {"op":"move","ids":[3],"parent":2,"position":{"type":"above","id":4}},
          {"op":"setText","id":5,"text":"hi","width":null},
          {"op":"boolean","ids":[1,2],"mode":"unite"}
        ]"#,
    )
    .expect("parses");
    assert_eq!(ops.len(), 6);
    assert!(matches!(
        &ops[4],
        Op::SetText {
            patch: TextPatch {
                width: Some(None),
                ..
            },
            ..
        }
    ));
}

#[test]
fn undo_and_redo_restore_exactly() {
    let mut d = doc();
    let mut h = History::new();
    let a = h.apply(&mut d, &[rect(10.0, 10.0)], None).expect("applies");
    let id = a.created[0];
    let b = h.apply(&mut d, &[rect(50.0, 10.0)], None).expect("applies");
    h.apply(
        &mut d,
        &[Op::Transform {
            ids: vec![id],
            matrix: Affine::translate(100.0, 0.0),
        }],
        None,
    )
    .expect("applies");
    let moved = crate::inspect::bounds(&d, &[id]);
    assert_eq!(moved, Some(Rect::from_xywh(110.0, 10.0, 20.0, 20.0)));
    h.undo(&mut d);
    assert_eq!(
        crate::inspect::bounds(&d, &[id]),
        Some(Rect::from_xywh(10.0, 10.0, 20.0, 20.0))
    );
    h.undo(&mut d);
    assert_eq!(layer_children(&d), [id], "the second rectangle is gone");
    h.redo(&mut d);
    assert_eq!(layer_children(&d), [id, b.created[0]]);
    assert!(h.can_redo());
}

#[test]
fn failed_batches_change_nothing() {
    let mut d = doc();
    let mut h = History::new();
    let before = d.nodes.len();
    let err = h.apply(
        &mut d,
        &[
            rect(10.0, 10.0),
            Op::SetPath {
                id: 999,
                data: PathData::default(),
                even_odd: None,
            },
        ],
        None,
    );
    assert!(err.is_err());
    assert_eq!(d.nodes.len(), before);
    assert!(layer_children(&d).is_empty());
    assert!(!h.can_undo());
}

#[test]
fn coalesced_steps_undo_together() {
    let mut d = doc();
    let mut h = History::new();
    let id = h
        .apply(&mut d, &[rect(0.0, 0.0)], None)
        .expect("applies")
        .created[0];
    for _ in 0..5 {
        h.apply(
            &mut d,
            &[Op::Transform {
                ids: vec![id],
                matrix: Affine::translate(1.0, 0.0),
            }],
            Some("drag"),
        )
        .expect("applies");
    }
    h.undo(&mut d);
    assert_eq!(crate::inspect::bounds(&d, &[id]).map(|r| r.x0), Some(0.0));
}

#[test]
fn group_ungroup_and_arrange() {
    let mut d = doc();
    let mut h = History::new();
    let ids: Vec<u32> = (0..3)
        .map(|k| {
            h.apply(&mut d, &[rect(f64::from(k) * 30.0, 0.0)], None)
                .expect("applies")
                .created[0]
        })
        .collect();
    h.apply(
        &mut d,
        &[Op::Group {
            ids: vec![ids[0], ids[2]],
        }],
        None,
    )
    .expect("groups");
    let children = layer_children(&d);
    assert_eq!(children.len(), 2);
    assert_eq!(children[0], ids[1], "the group sits where the topmost was");
    let g = *children.last().expect("group");
    let gi = d.find(g).expect("group");
    let inner: Vec<u32> = d.node(gi).children.iter().map(|&c| d.node(c).id).collect();
    assert_eq!(inner, [ids[0], ids[2]]);

    h.apply(&mut d, &[Op::Ungroup { ids: vec![g] }], None)
        .expect("ungroups");
    assert_eq!(layer_children(&d), [ids[1], ids[0], ids[2]]);

    let layer = d.node(d.layers[0]).id;
    h.apply(
        &mut d,
        &[Op::Move {
            ids: vec![ids[2]],
            parent: Some(layer),
            position: Position::Bottom,
        }],
        None,
    )
    .expect("moves");
    assert_eq!(layer_children(&d), [ids[2], ids[1], ids[0]]);
}

#[test]
fn clipping_masks() {
    let mut d = doc();
    let mut h = History::new();
    let below = h
        .apply(&mut d, &[rect(0.0, 0.0)], None)
        .expect("applies")
        .created[0];
    let clip = h
        .apply(
            &mut d,
            &[Op::Create {
                node: NewNode::Ellipse {
                    rect: Rect::from_xywh(5.0, 5.0, 10.0, 10.0),
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
    h.apply(
        &mut d,
        &[Op::MakeClip {
            ids: vec![below, clip],
        }],
        None,
    )
    .expect("clips");
    let g = d.find(layer_children(&d)[0]).expect("group");
    assert!(matches!(
        d.node(g).kind,
        NodeKind::Group { clip: Some(_), .. }
    ));
    assert_eq!(
        crate::inspect::bounds(&d, &[d.node(g).id]),
        Some(Rect::from_xywh(5.0, 5.0, 10.0, 10.0))
    );
    let gid = d.node(g).id;
    h.apply(&mut d, &[Op::ReleaseClip { ids: vec![gid] }], None)
        .expect("releases");
    assert!(matches!(d.node(g).kind, NodeKind::Group { clip: None, .. }));
    assert_eq!(d.node(g).children.len(), 2);
}

#[test]
fn duplicates_are_new_nodes_moved() {
    let mut d = doc();
    let mut h = History::new();
    let id = h
        .apply(&mut d, &[rect(0.0, 0.0)], None)
        .expect("applies")
        .created[0];
    let a = h
        .apply(
            &mut d,
            &[Op::Duplicate {
                ids: vec![id],
                offset: Some([10.0, 10.0]),
            }],
            None,
        )
        .expect("duplicates");
    let copy = a.created[0];
    assert_ne!(copy, id);
    assert_eq!(layer_children(&d), [id, copy]);
    assert_eq!(
        crate::inspect::bounds(&d, &[copy]),
        Some(Rect::from_xywh(10.0, 10.0, 20.0, 20.0))
    );
}

#[test]
fn text_edits_and_outlines() {
    let mut d = doc();
    let mut h = History::new();
    let id = h
        .apply(
            &mut d,
            &[Op::Create {
                node: NewNode::Text {
                    at: Point::new(10.0, 40.0),
                    text: "Hello".into(),
                    family: "Inter".into(),
                    style: "Regular".into(),
                    size: 20.0,
                    fill: Some(Paint::Solid {
                        color: Color::BLACK,
                    }),
                    width: None,
                    align: TextAlign::Left,
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("creates")
        .created[0];
    let narrow = crate::inspect::bounds(&d, &[id]).expect("bounds");
    h.apply(
        &mut d,
        &[Op::SetText {
            id,
            patch: TextPatch {
                text: Some("Hello, world".into()),
                ..Default::default()
            },
        }],
        None,
    )
    .expect("edits");
    let wide = crate::inspect::bounds(&d, &[id]).expect("bounds");
    assert!(wide.width() > narrow.width() * 1.5);
    h.apply(&mut d, &[Op::Outline { ids: vec![id] }], None)
        .expect("outlines");
    let out = d.find(layer_children(&d)[0]).expect("outline");
    assert!(matches!(d.node(out).kind, NodeKind::Path(_)));
    let b = crate::inspect::bounds(&d, &[d.node(out).id]).expect("bounds");
    assert!(wide.outset(1.0).contains_rect(&b), "{wide:?} {b:?}");
}

#[test]
fn booleans_combine_paths() {
    let mut d = doc();
    let mut h = History::new();
    let a = h
        .apply(&mut d, &[rect(0.0, 0.0)], None)
        .expect("applies")
        .created[0];
    let b = h
        .apply(&mut d, &[rect(10.0, 0.0)], None)
        .expect("applies")
        .created[0];
    h.apply(
        &mut d,
        &[Op::Boolean {
            ids: vec![a, b],
            mode: BooleanMode::Unite,
        }],
        None,
    )
    .expect("combines");
    let children = layer_children(&d);
    assert_eq!(children.len(), 1);
    assert_eq!(
        crate::inspect::bounds(&d, &children),
        Some(Rect::from_xywh(0.0, 0.0, 30.0, 20.0))
    );
}

#[test]
fn artboards_and_layers() {
    let mut d = doc();
    let mut h = History::new();
    h.apply(
        &mut d,
        &[
            Op::NewArtboard {
                rect: Rect::from_xywh(500.0, 0.0, 100.0, 100.0),
                name: None,
            },
            Op::NewLayer {
                name: Some("Top".into()),
                position: Position::Top,
            },
        ],
        None,
    )
    .expect("adds");
    assert_eq!(d.artboards.len(), 2);
    assert_eq!(d.artboards[1].name, "Artboard 2");
    assert_eq!(d.node(*d.layers.last().expect("layer")).name, "Top");
    // New objects go in the top layer, on the artboard they are on.
    let id = h
        .apply(&mut d, &[rect(510.0, 10.0)], None)
        .expect("applies")
        .created[0];
    let n = d.node(d.find(id).expect("node"));
    assert_eq!(n.parent, Some(*d.layers.last().expect("layer")));
    assert_eq!(n.artboard, d.artboards[1].id);
    let first = d.artboards[0].id;
    h.apply(&mut d, &[Op::DeleteArtboard { id: first }], None)
        .expect("deletes");
    let last = d.artboards[1].id;
    assert!(
        h.apply(&mut d, &[Op::DeleteArtboard { id: last }], None)
            .is_err(),
        "one stays"
    );
}
