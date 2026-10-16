use super::*;
use crate::edit::{History, NewNode, NodePatch, Op, Position};
use crate::geom::Point;
use crate::model::{Color, Paint};

/// A stored file two people open.
fn file() -> Vec<u8> {
    let mut doc = crate::save::blank(400.0, 300.0);
    History::new()
        .apply(
            &mut doc,
            &[Op::Create {
                node: NewNode::Rect {
                    rect: Rect::from_xywh(10.0, 10.0, 50.0, 50.0),
                    radius: 0.0,
                    fill: Some(Paint::Solid {
                        color: Color::BLACK,
                    }),
                    stroke: None,
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("applies");
    crate::save::save(&doc).expect("saves")
}

struct Person {
    doc: Document,
    history: History,
    collab: Collab,
}

impl Person {
    fn open(bytes: &[u8], session: u16) -> Person {
        let mut doc = crate::build::open(bytes).expect("opens").document;
        let collab = Collab::new(&mut doc, session);
        Person {
            doc,
            history: History::new(),
            collab,
        }
    }

    fn edit(&mut self, ops: Vec<Op>) -> Vec<u32> {
        let applied = self
            .history
            .apply(&mut self.doc, &ops, None)
            .expect("applies");
        self.collab.record(&self.doc, &applied);
        applied.created
    }

    fn undo(&mut self) {
        let applied = self.history.undo(&mut self.doc).expect("undoes");
        self.collab.record(&self.doc, &applied);
    }

    fn send(&mut self, to: &mut Person) -> Remote {
        let changes = self.collab.changes(&self.doc);
        // Through JSON, as the web app sends them.
        let json = serde_json::to_string(&changes).expect("serializes");
        let changes: Vec<EntryChange> = serde_json::from_str(&json).expect("parses");
        to.collab.apply(&mut to.doc, &changes)
    }
}

fn shapes(doc: &Document) -> Vec<(u32, Rect)> {
    doc.node(doc.layers[0])
        .children
        .iter()
        .filter(|&&c| !doc.node(c).removed)
        .map(|&c| (doc.node(c).id, node_bounds(doc, c).expect("bounds")))
        .collect()
}

fn rect_op(x: f64) -> Op {
    Op::Create {
        node: NewNode::Rect {
            rect: Rect::from_xywh(x, 100.0, 20.0, 20.0),
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
    }
}

#[test]
fn edits_reach_the_other_person() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    assert_eq!(shapes(&a.doc), shapes(&b.doc), "the same ids from the file");
    let square = shapes(&a.doc)[0].0;
    a.edit(vec![Op::Transform {
        ids: vec![square],
        matrix: crate::geom::Affine::translate(100.0, 0.0),
    }]);
    let created = a.edit(vec![rect_op(200.0)]);
    let remote = a.send(&mut b);
    assert!(remote.structure);
    assert!(remote.dirty.is_some());
    assert_eq!(shapes(&a.doc), shapes(&b.doc));
    assert_eq!(created[0] >> 20, 1, "in the creator's session");
}

#[test]
fn concurrent_creations_both_land() {
    let bytes = file();
    let mut a = Person::open(&bytes, 7);
    let mut b = Person::open(&bytes, 9);
    let ia = a.edit(vec![rect_op(100.0)])[0];
    let ib = b.edit(vec![rect_op(150.0)])[0];
    assert_ne!(ia, ib);
    a.send(&mut b);
    b.send(&mut a);
    let sa: Vec<u32> = shapes(&a.doc).into_iter().map(|s| s.0).collect();
    let sb: Vec<u32> = shapes(&b.doc).into_iter().map(|s| s.0).collect();
    assert_eq!(sa, sb, "the same order for both");
    assert_eq!(sa.len(), 3);
}

#[test]
fn deletes_undos_and_properties() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    let square = shapes(&a.doc)[0].0;
    a.edit(vec![Op::SetNode {
        ids: vec![square],
        patch: NodePatch {
            name: Some("Square".into()),
            opacity: Some(0.25),
            ..Default::default()
        },
    }]);
    a.send(&mut b);
    let i = b.doc.find(square).expect("node");
    assert_eq!(b.doc.node(i).name, "Square");
    assert_eq!(b.doc.node(i).opacity, 0.25);

    a.edit(vec![Op::Delete { ids: vec![square] }]);
    a.send(&mut b);
    assert!(shapes(&b.doc).is_empty());
    a.undo();
    a.send(&mut b);
    assert_eq!(shapes(&b.doc).len(), 1);
}

#[test]
fn fills_and_text_are_shared_as_content() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    let square = shapes(&a.doc)[0].0;
    let created = a.edit(vec![
        Op::SetFill {
            ids: vec![square],
            fill: Some(Paint::Solid {
                color: Color::Rgb {
                    r: 0.0,
                    g: 0.5,
                    b: 1.0,
                },
            }),
        },
        Op::Create {
            node: NewNode::Text {
                at: Point::new(20.0, 200.0),
                text: "Shared".into(),
                family: "Inter".into(),
                style: "Regular".into(),
                size: 18.0,
                fill: Some(Paint::Solid {
                    color: Color::BLACK,
                }),
                width: None,
                align: crate::model::TextAlign::Left,
            },
            parent: None,
            position: Position::Top,
        },
    ]);
    a.send(&mut b);
    let i = b.doc.find(square).expect("node");
    let NodeKind::Path(p) = &b.doc.node(i).kind else {
        panic!("a path")
    };
    assert!(matches!(p.fill, Some(Paint::Solid { color: Color::Rgb { b, .. } }) if b == 1.0));
    assert!(crate::describe::text(&b.doc).contains("Shared"));
    assert!(b.doc.find(created[0]).is_some());
}

#[test]
fn copies_of_file_objects_draw_with_their_operators() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    let square = shapes(&a.doc)[0].0;
    let copy = a.edit(vec![Op::Duplicate {
        ids: vec![square],
        offset: Some([0.0, 100.0]),
    }])[0];
    a.send(&mut b);
    let i = b.doc.find(copy).expect("the copy arrived");
    assert!(
        b.doc.node(i).source.is_some(),
        "it shares the original's source"
    );
    let saved = crate::save::save(&b.doc).expect("saves");
    let again = crate::build::open(&saved).expect("reopens").document;
    assert_eq!(shapes(&again).len(), 2);
}

#[test]
fn placed_images_are_shared() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    let rgba: Vec<u8> = (0..16).flat_map(|_| [0, 128, 255, 255]).collect();
    a.edit(vec![Op::PlaceImage {
        name: "blue".into(),
        rect: Rect::from_xywh(100.0, 100.0, 40.0, 40.0),
        parent: None,
        hash: "abc".into(),
        image: Some(AddedImage {
            width: 4,
            height: 4,
            rgba: rgba.clone().into(),
            jpeg: None,
        }),
    }]);
    a.send(&mut b);
    let img = b.doc.images.get("abc").expect("the image arrived");
    assert_eq!(&img.rgba[..], &rgba[..]);
}

#[test]
fn artboards_are_shared() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let mut b = Person::open(&bytes, 2);
    a.edit(vec![Op::NewArtboard {
        rect: Rect::from_xywh(500.0, 0.0, 200.0, 200.0),
        name: Some("Second".into()),
    }]);
    let remote = a.send(&mut b);
    assert!(remote.structure);
    assert_eq!(b.doc.artboards.len(), 2);
    assert_eq!(b.doc.artboards[1].name, "Second");
}

#[test]
fn seeds_and_base64() {
    let bytes = file();
    let mut a = Person::open(&bytes, 1);
    let seed = a.collab.seed(&a.doc);
    assert_eq!(seed[0].key, meta::FORMAT);
    for data in [&b""[..], b"f", b"fo", b"foo", b"foob", b"\xff\x00\x10"] {
        assert_eq!(base64_decode(&base64_encode(data)).as_deref(), Some(data));
    }
}
