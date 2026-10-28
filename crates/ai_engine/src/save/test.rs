use super::*;
use crate::build::open;
use crate::edit::{History, NewNode, Op, Position, TextPatch};
use crate::geom::Point;
use crate::model::{Color, Paint, TextAlign};
use crate::testing::{PdfBuilder, dict, draw, helvetica, name, pixel};

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
fn object_and_artboard_names_round_trip() {
    let mut doc = open(&sample()).expect("opens").document;
    let art = layer(&doc, "Art");
    let shape = doc.node(doc.node(art).children[0]).id;
    let text = doc.node(doc.node(art).children[2]).id;
    let board = doc.artboards[0].id;
    let art_id = doc.node(art).id;
    let rename = |id: u32, name: &str| Op::SetNode {
        ids: vec![id],
        patch: crate::edit::NodePatch {
            name: Some(name.into()),
            ..Default::default()
        },
    };
    apply(
        &mut doc,
        vec![
            rename(shape, "Red square"),
            rename(text, "Greeting"),
            Op::SetText {
                id: text,
                patch: TextPatch {
                    text: Some("Hello".into()),
                    ..Default::default()
                },
            },
            Op::SetArtboard {
                id: board,
                name: Some("Cover".into()),
                rect: None,
            },
            Op::Create {
                node: NewNode::Rect {
                    rect: Rect::new(150.0, 10.0, 190.0, 30.0),
                    radius: 0.0,
                    fill: Some(Paint::Solid {
                        color: Color::BLACK,
                    }),
                    stroke: None,
                },
                parent: Some(art_id),
                position: Position::Top,
            },
        ],
    );
    let again = reopen(&doc);
    assert_eq!(again.artboards[0].name, "Cover");
    let names: Vec<&str> = again
        .node(self::layer(&again, "Art"))
        .children
        .iter()
        .map(|&c| again.node(c).name.as_str())
        .collect();
    // New shapes keep the name they were made with; the blue square the
    // file drew, unnamed, stays so.
    assert_eq!(names, ["Red square", "", "Greeting", "Rectangle"]);
    // Files from elsewhere name their artboards in order.
    let plain = open(&sample()).expect("opens").document;
    assert_eq!(plain.artboards[0].name, "Artboard 1");
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

#[test]
fn text_keeps_leading_set_by_earlier_blocks() {
    let mut b = PdfBuilder::new();
    let resources = dict(vec![(
        "Font",
        Object::Dict(dict(vec![("F1", helvetica())])),
    )]);
    b.page(
        200.0,
        100.0,
        "BT /F1 10 Tf 10 80 Td (A) Tj 0 -20 TD (B) Tj ET BT 10 50 Td T* (C) Tj ET",
        resources,
    );
    let mut doc = open(&b.finish()).expect("opens").document;
    let before: Vec<Option<Rect>> = doc
        .paint_order()
        .into_iter()
        .map(|i| node_bounds(&doc, i))
        .collect();
    let id = doc.node(doc.layers[0]).id;
    apply(
        &mut doc,
        vec![Op::SetNode {
            ids: vec![id],
            patch: crate::edit::NodePatch {
                name: Some("Text".into()),
                ..Default::default()
            },
        }],
    );
    let again = reopen(&doc);
    let after: Vec<Option<Rect>> = again
        .paint_order()
        .into_iter()
        .map(|i| node_bounds(&again, i))
        .collect();
    assert_eq!(before, after);
    assert_eq!(draw(&again).2, draw(&doc).2);
}

#[test]
fn patterns_move_with_their_objects() {
    let mut b = PdfBuilder::new();
    let shading = dict(vec![
        ("ShadingType", Object::Int(2)),
        ("ColorSpace", name("DeviceRGB")),
        ("Coords", crate::testing::nums(&[0.0, 0.0, 40.0, 0.0])),
        (
            "Function",
            Object::Dict(dict(vec![
                ("FunctionType", Object::Int(2)),
                ("Domain", crate::testing::nums(&[0.0, 1.0])),
                ("C0", crate::testing::nums(&[1.0, 0.0, 0.0])),
                ("C1", crate::testing::nums(&[0.0, 0.0, 1.0])),
                ("N", Object::Int(1)),
            ])),
        ),
    ]);
    let pattern = dict(vec![
        ("PatternType", Object::Int(2)),
        ("Shading", Object::Dict(shading)),
        (
            "Matrix",
            crate::testing::nums(&[1.0, 0.0, 0.0, 1.0, 10.0, 10.0]),
        ),
    ]);
    let form = b.stream(
        dict(vec![
            ("Type", name("XObject")),
            ("Subtype", name("Form")),
            ("BBox", crate::testing::nums(&[0.0, 0.0, 200.0, 100.0])),
            (
                "Matrix",
                crate::testing::nums(&[1.0, 0.0, 0.0, 1.0, 20.0, 0.0]),
            ),
            (
                "Resources",
                Object::Dict(dict(vec![(
                    "Pattern",
                    Object::Dict(dict(vec![("P0", Object::Dict(pattern))])),
                )])),
            ),
        ]),
        "/Pattern cs /P0 scn 10 10 40 40 re f",
    );
    let resources = dict(vec![(
        "XObject",
        Object::Dict(dict(vec![("Fm0", Object::Ref(form))])),
    )]);
    b.page(200.0, 100.0, "/Fm0 Do", resources);
    let mut doc = open(&b.finish()).expect("opens").document;
    let leaf = *doc
        .paint_order()
        .iter()
        .find(|&&i| !doc.node(i).is_container())
        .expect("the rectangle");
    let id = doc.node(leaf).id;
    apply(
        &mut doc,
        vec![Op::Transform {
            ids: vec![id],
            matrix: Affine::translate(50.0, 20.0),
        }],
    );
    let moved = draw(&doc);
    let again = reopen(&doc);
    let img = draw(&again);
    let diff: u64 = moved
        .2
        .iter()
        .zip(&img.2)
        .map(|(a, b)| u64::from(a.abs_diff(*b)))
        .sum();
    assert!(diff < 2000, "{diff}");
    // Red at the moved rectangle's left, blue at its right.
    let left = pixel(&img, 82, 80);
    let right = pixel(&img, 118, 80);
    assert!(left[0] > 200 && left[2] < 60, "{left:?}");
    assert!(right[2] > 200 && right[0] < 60, "{right:?}");
}

#[test]
fn gradients_with_transparent_stops_save_as_soft_masks() {
    use crate::model::{Gradient, GradientStop, NodeKind};
    use crate::pdf::Pdf;

    let mut doc = open(&sample()).expect("opens").document;
    let red = first_child(&doc, "Art").id;
    let stop = |offset: f32, opacity: f32| GradientStop {
        offset,
        color: Color::BLACK,
        opacity,
    };
    // Across the red square (page space 10..40): black fading out.
    let gradient = Gradient {
        transform: Affine::IDENTITY,
        radial: false,
        start: Point::new(10.0, 0.0),
        end: Point::new(40.0, 0.0),
        start_radius: 0.0,
        end_radius: 0.0,
        stops: vec![stop(0.0, 1.0), stop(1.0, 0.0)],
        extend: [true, true],
    };
    let fill = Paint::Gradient {
        gradient: gradient.clone(),
    };
    apply(
        &mut doc,
        vec![Op::SetFill {
            ids: vec![red],
            fill: Some(fill.clone()),
        }],
    );
    let bytes = save(&doc).expect("saves");

    // Other readers get a soft mask of the stops' opacities.
    let pdf = Pdf::open(bytes.clone().into()).expect("parses");
    fn find_smask(pdf: &Pdf, o: &Object, depth: usize) -> Option<Object> {
        let o = pdf.resolve(o);
        let d = o.as_dict()?;
        if let Some(m) = d.get("SMask") {
            return Some(m.clone());
        }
        if depth == 0 {
            return None;
        }
        d.iter()
            .filter(|(k, _)| k.as_bytes() != b"Parent")
            .find_map(|(_, v)| find_smask(pdf, v, depth - 1))
    }
    let masks: Vec<Object> = pdf
        .object_refs()
        .into_iter()
        .filter_map(|r| pdf.get(r))
        .filter_map(|o| find_smask(&pdf, &o, 3))
        .collect();
    let smask = masks.first().expect("an ExtGState with a soft mask");
    let smask = pdf.resolve(smask);
    let smask = smask.as_dict().expect("a mask dictionary");
    assert_eq!(
        smask
            .get("S")
            .and_then(Object::as_name)
            .map(|n| n.as_bytes()),
        Some(&b"Luminosity"[..])
    );

    // The engine reads the path back, stops and all.
    let again = open(&bytes).expect("reopens").document;
    let n = first_child(&again, "Art");
    let NodeKind::Path(p) = &n.kind else {
        panic!("a path, not raw content: {:?}", n.kind)
    };
    assert_eq!(p.fill, Some(fill));
    let img = draw(&again);
    let (solid, faded) = (pixel(&img, 12, 75), pixel(&img, 38, 75));
    assert!(solid[0] < 40, "{solid:?}");
    assert!(faded[0] > 215, "{faded:?}");
}
