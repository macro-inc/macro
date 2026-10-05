use crate::document::Document;
use crate::edit::{History, Op};
use crate::model::{Guid, Rect, Vec2};
use crate::testing::simple_file;

fn apply(doc: &mut Document, h: &mut History, json: &str) {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    h.apply(doc, &ops, None).unwrap();
}

fn frame(doc: &Document, id: &str) -> (Rect, Vec2) {
    let i = doc.find(Guid::parse(id).unwrap()).unwrap();
    let size = doc.props(i).size();
    let world = doc.world(i);
    (
        world.map_rect(&Rect::new(0.0, 0.0, size.x, size.y)),
        world.apply(Vec2::default()),
    )
}

#[test]
fn flips_about_the_center_and_undoes() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let (before, _) = frame(&doc, "1:3");
    apply(&mut doc, &mut h, r#"[{"op":"flip","ids":["1:3"]}]"#);
    let (bounds, origin) = frame(&doc, "1:3");
    assert_eq!(bounds, before, "it stays in place");
    // The layer's origin is now its right edge.
    assert_eq!(origin, Vec2::new(110.0, 20.0));
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"flip","ids":["1:3"],"vertical":true}]"#,
    );
    let (bounds, origin) = frame(&doc, "1:3");
    assert_eq!(bounds, before);
    assert_eq!(origin, Vec2::new(110.0, 70.0));
    h.undo(&mut doc);
    h.undo(&mut doc);
    assert_eq!(frame(&doc, "1:3").1, Vec2::new(10.0, 20.0));
}

#[test]
fn flipping_twice_restores_the_layer() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let i = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    let start = doc.props(i).transform();
    for _ in 0..2 {
        apply(&mut doc, &mut h, r#"[{"op":"flip","ids":["1:3"]}]"#);
    }
    assert_eq!(doc.props(i).transform(), start);
}
