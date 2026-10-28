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

/// The panel's rotation, X, and Y of `id`.
fn panel(doc: &Document, id: &str) -> (f64, f64, f64) {
    let scene = crate::scene::Scene::build(doc, doc.pages[0]);
    let info = crate::inspect::node_info(doc, &scene, scene.find(doc, id).unwrap());
    let round = |v: f64| (v * 1000.0).round() / 1000.0 + 0.0;
    (round(info.rotation), round(info.x), round(info.y))
}

#[test]
fn the_panel_keeps_a_flip_apart_from_rotation() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    apply(&mut doc, &mut h, r#"[{"op":"flip","ids":["1:3"]}]"#);
    // A horizontal flip keeps the angle and the top left corner.
    assert_eq!(panel(&doc, "1:3"), (0.0, 10.0, 20.0));
    // Typing a rotation turns the flipped layer about its center.
    let (before, _) = frame(&doc, "1:3");
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"set","ids":["1:3"],"props":{"rotation":90}}]"#,
    );
    let i = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    assert!(doc.world(i).is_mirrored(), "it stays flipped");
    assert_eq!(panel(&doc, "1:3").0, 90.0);
    let center = |r: Rect| ((r.x + r.w / 2.0).round(), (r.y + r.h / 2.0).round());
    assert_eq!(center(frame(&doc, "1:3").0), center(before));
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"set","ids":["1:3"],"props":{"rotation":0}}]"#,
    );
    assert_eq!(panel(&doc, "1:3"), (0.0, 10.0, 20.0), "back where it was");
    // Typing X and Y moves the flipped layer's top left corner there.
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"set","ids":["1:3"],"props":{"x":30,"y":40}}]"#,
    );
    assert_eq!(panel(&doc, "1:3"), (0.0, 30.0, 40.0));
    assert_eq!(frame(&doc, "1:3").0, Rect::new(30.0, 40.0, 100.0, 50.0));
    // A vertical flip reads as a half turn of the horizontally flipped layer.
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"flip","ids":["1:3"]},{"op":"flip","ids":["1:3"],"vertical":true}]"#,
    );
    assert_eq!(panel(&doc, "1:3").0.abs(), 180.0);
}

#[test]
fn rotation_in_a_rotated_group_is_the_page_angle() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    // Turning the frame turns its rectangle with it.
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"set","ids":["1:2"],"props":{"rotation":30}}]"#,
    );
    assert_eq!(panel(&doc, "1:3").0, 30.0);
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"set","ids":["1:3"],"props":{"rotation":45}}]"#,
    );
    assert_eq!(panel(&doc, "1:3").0, 45.0, "what was typed, not 75°");
}
