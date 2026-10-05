use super::*;
use crate::build::open;
use crate::edit::{History, NewNode, Op, Position, TextPatch};
use crate::geom::Point;
use crate::model::{Color, Paint, TextAlign};
use crate::testing::{PdfBuilder, dict, draw, helvetica, pixel};

fn sample() -> Vec<u8> {
    let mut b = PdfBuilder::new();
    let art = b.ocg("Art");
    let hidden = b.ocg("Notes");
    b.layers(&[hidden, art], &[hidden]);
    let resources = dict(vec![
        ("Font", Object::Dict(dict(vec![("F1", helvetica())]))),
        (
            "Properties",
            Object::Dict(dict(vec![
                ("MC0", Object::Ref(art)),
                ("MC1", Object::Ref(hidden)),
            ])),
        ),
    ]);
    b.page(
        200.0,
        100.0,
        "/OC /MC0 BDC 1 0 0 rg 10 10 30 30 re f \
         q 60 10 40 40 re W n 0 0 1 rg 50 0 100 100 re f Q \
         BT /F1 12 Tf 1 0 0 1 120 60 Tm (Hi there) Tj ET EMC \
         /OC /MC1 BDC 0 g 0 90 10 10 re f EMC",
        resources,
    );
    b.finish()
}

fn apply(doc: &mut Document, ops: Vec<Op>) {
    History::new().apply(doc, &ops, None).expect("applies");
}

fn reopen(doc: &Document) -> Document {
    open(&save(doc).expect("saves")).expect("reopens").document
}

/// The layer with a name.
fn layer(doc: &Document, name: &str) -> NodeIdx {
    *doc.layers
        .iter()
        .find(|&&l| doc.node(l).name == name)
        .expect("the layer")
}

fn first_child<'a>(doc: &'a Document, name: &str) -> &'a Node {
    doc.node(doc.node(layer(doc, name)).children[0])
}

#[test]
fn unedited_documents_save_byte_for_byte() {
    let bytes = sample();
    let doc = open(&bytes).expect("opens").document;
    assert_eq!(save(&doc).expect("saves"), bytes);
}

#[test]
fn saving_keeps_what_was_not_edited() {
    let mut doc = open(&sample()).expect("opens").document;
    let before = draw(&doc);
    // Touch the layer's name only: everything is written again.
    let id = doc.node(layer(&doc, "Art")).id;
    apply(
        &mut doc,
        vec![Op::SetNode {
            ids: vec![id],
            patch: crate::edit::NodePatch {
                name: Some("Artwork".into()),
                ..Default::default()
            },
        }],
    );
    let again = reopen(&doc);
    assert_eq!(draw(&again).2, before.2, "draws the same");
    let names: Vec<&str> = again
        .layers
        .iter()
        .map(|&l| again.node(l).name.as_str())
        .collect();
    assert_eq!(names, ["Artwork", "Notes"], "bottom to top");
    assert!(
        again.node(layer(&again, "Notes")).hidden,
        "a layer off stays off"
    );
    let kinds: Vec<&str> = again
        .node(layer(&again, "Artwork"))
        .children
        .iter()
        .map(|&c| crate::inspect::kind_word(&again.node(c).kind))
        .collect();
    assert_eq!(kinds, ["path", "clipGroup", "text"]);
}

#[test]
fn moves_and_fills_are_saved() {
    let mut doc = open(&sample()).expect("opens").document;
    let red = first_child(&doc, "Art").id;
    apply(
        &mut doc,
        vec![
            Op::Transform {
                ids: vec![red],
                matrix: Affine::translate(20.0, 0.0),
            },
            Op::SetFill {
                ids: vec![red],
                fill: Some(Paint::Solid {
                    color: Color::Rgb {
                        r: 0.0,
                        g: 1.0,
                        b: 0.0,
                    },
                }),
            },
        ],
    );
    let again = reopen(&doc);
    let n = first_child(&again, "Art");
    assert_eq!(
        node_bounds(&again, again.find(n.id).expect("same id")),
        Some(Rect::new(30.0, 60.0, 60.0, 90.0))
    );
    let img = draw(&again);
    assert_eq!(pixel(&img, 45, 75), [0, 255, 0, 255]);
    assert_eq!(pixel(&img, 15, 75), [255, 255, 255, 255]);
}

#[test]
fn moved_unedited_objects_keep_their_operators() {
    let mut doc = open(&sample()).expect("opens").document;
    let text = doc.node(layer(&doc, "Art")).children[2];
    let id = doc.node(text).id;
    apply(
        &mut doc,
        vec![Op::Transform {
            ids: vec![id],
            matrix: Affine::translate(-100.0, 10.0),
        }],
    );
    let again = reopen(&doc);
    let art = layer(&again, "Art");
    let t = again.node(again.node(art).children[2]);
    let NodeKind::Text(t) = &t.kind else {
        panic!("text")
    };
    assert_eq!(t.text, "Hi there");
    assert!(t.runs.is_some(), "still the file's glyphs");
    let b = node_bounds(&again, again.node(art).children[2]).expect("bounds");
    assert!((b.x0 - 20.0).abs() < 1.0, "{b:?}");
}

#[test]
fn edited_text_reads_back_as_text() {
    let mut doc = open(&sample()).expect("opens").document;
    let text = doc.node(layer(&doc, "Art")).children[2];
    let id = doc.node(text).id;
    apply(
        &mut doc,
        vec![Op::SetText {
            id,
            patch: TextPatch {
                text: Some("Edited\ntwo lines".into()),
                family: Some("Inter".into()),
                style: Some("Bold".into()),
                align: Some(TextAlign::Center),
                ..Default::default()
            },
        }],
    );
    let transform = doc.node(text).transform;
    let again = reopen(&doc);
    let t = again.node(again.node(layer(&again, "Art")).children[2]);
    let NodeKind::Text(tn) = &t.kind else {
        panic!("text")
    };
    assert_eq!(tn.text, "Edited\ntwo lines");
    assert_eq!((tn.family.as_str(), tn.style.as_str()), ("Inter", "Bold"));
    assert_eq!(tn.align, TextAlign::Center);
    assert!(tn.runs.is_none());
    for k in 0..6 {
        assert!(
            (t.transform.0[k] - transform.0[k]).abs() < 1e-3,
            "{:?} {:?}",
            t.transform,
            transform
        );
    }
}

#[test]
fn groups_hidden_objects_and_new_shapes_round_trip() {
    let mut doc = open(&sample()).expect("opens").document;
    let layer = layer(&doc, "Art");
    let ids: Vec<u32> = doc.node(layer).children[..2]
        .iter()
        .map(|&c| doc.node(c).id)
        .collect();
    apply(&mut doc, vec![Op::Group { ids: ids.clone() }]);
    let group = doc.node(layer).children[0];
    let gid = doc.node(group).id;
    let layer_id = doc.node(layer).id;
    apply(
        &mut doc,
        vec![
            Op::SetNode {
                ids: vec![gid],
                patch: crate::edit::NodePatch {
                    name: Some("Shapes".into()),
                    opacity: Some(0.5),
                    ..Default::default()
                },
            },
            Op::Create {
                node: NewNode::Ellipse {
                    rect: Rect::new(150.0, 10.0, 190.0, 30.0),
                    fill: Some(Paint::Solid {
                        color: Color::Cmyk {
                            c: 0.0,
                            m: 1.0,
                            y: 0.0,
                            k: 0.0,
                        },
                    }),
                    stroke: None,
                },
                parent: Some(layer_id),
                position: Position::Top,
            },
            Op::SetNode {
                ids: vec![ids[0]],
                patch: crate::edit::NodePatch {
                    hidden: Some(true),
                    ..Default::default()
                },
            },
        ],
    );
    let again = reopen(&doc);
    let layer = self::layer(&again, "Art");
    let kinds: Vec<&str> = again
        .node(layer)
        .children
        .iter()
        .map(|&c| crate::inspect::kind_word(&again.node(c).kind))
        .collect();
    assert_eq!(kinds, ["group", "text", "path"]);
    let g = again.node(again.node(layer).children[0]);
    assert_eq!(g.name, "Shapes");
    assert_eq!(g.opacity, 0.5);
    let inner: Vec<bool> = g.children.iter().map(|&c| again.node(c).hidden).collect();
    assert_eq!(inner, [true, false]);
    let ellipse = again.node(again.node(layer).children[2]);
    let NodeKind::Path(p) = &ellipse.kind else {
        panic!("a path")
    };
    assert!(matches!(
        p.fill,
        Some(Paint::Solid {
            color: Color::Cmyk { m, .. }
        }) if m == 1.0
    ));
}

#[test]
fn new_documents_open() {
    let bytes = blank_file(300.0, 200.0).expect("writes");
    let mut doc = open(&bytes).expect("opens").document;
    assert_eq!(doc.artboards[0].rect, Rect::new(0.0, 0.0, 300.0, 200.0));
    assert_eq!(doc.layers.len(), 1);
    apply(
        &mut doc,
        vec![Op::Create {
            node: NewNode::Text {
                at: Point::new(20.0, 50.0),
                text: "Hello".into(),
                family: "Inter".into(),
                style: "Regular".into(),
                size: 24.0,
                fill: Some(Paint::Solid {
                    color: Color::BLACK,
                }),
                width: None,
                align: TextAlign::Left,
            },
            parent: None,
            position: Position::Top,
        }],
    );
    let again = reopen(&doc);
    assert!(crate::describe::text(&again).contains("Hello"));
    let img = draw(&again);
    let dark = img.2.chunks_exact(4).filter(|p| p[0] < 128).count();
    assert!(dark > 20, "the text draws");
}

#[test]
fn placed_images_save() {
    let mut doc = open(&blank_file(100.0, 100.0).expect("writes"))
        .expect("opens")
        .document;
    let rgba: Vec<u8> = (0..4 * 4).flat_map(|_| [255, 0, 0, 255]).collect();
    apply(
        &mut doc,
        vec![Op::PlaceImage {
            name: "red".into(),
            rect: Rect::new(10.0, 10.0, 50.0, 50.0),
            parent: None,
            hash: "red".into(),
            image: Some(crate::model::AddedImage {
                width: 4,
                height: 4,
                rgba: rgba.into(),
                jpeg: None,
            }),
        }],
    );
    let again = reopen(&doc);
    let img = draw(&again);
    assert_eq!(pixel(&img, 30, 30), [255, 0, 0, 255]);
    assert_eq!(pixel(&img, 70, 70), [255, 255, 255, 255]);
}
