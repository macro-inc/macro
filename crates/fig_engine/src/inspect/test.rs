use super::*;
use crate::model::Vec2;
use crate::testing::simple_file;

fn open() -> (Document, Scene) {
    let doc = Document::open(&simple_file()).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    (doc, scene)
}

#[test]
fn hit_tests_from_the_top_level_down() {
    let (doc, scene) = open();
    let chain: Vec<String> = hit_test(&doc, &scene, Vec2::new(50.0, 40.0), 0.0)
        .into_iter()
        .map(|i| scene.id(&doc, i))
        .collect();
    assert_eq!(chain, ["1:2", "1:3"]);
    let frame_only: Vec<String> = hit_test(&doc, &scene, Vec2::new(150.0, 150.0), 0.0)
        .into_iter()
        .map(|i| scene.id(&doc, i))
        .collect();
    assert_eq!(frame_only, ["1:2"]);
    assert!(hit_test(&doc, &scene, Vec2::new(500.0, 500.0), 0.0).is_empty());
}

#[test]
fn lists_layers_frames_and_search_hits() {
    let (doc, scene) = open();
    let rows = layer_rows(&doc, &scene, scene.root());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Frame");
    assert_eq!(rows[0].child_count, 1);
    let frames = frames(&doc, &scene);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].bounds.w, 200.0);
    let hits = search(&doc, &scene, "red", 10);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "1:3");
}

#[test]
fn describes_a_node() {
    let (doc, scene) = open();
    let rect = scene.find(&doc, "1:3").unwrap();
    let info = node_info(&doc, &scene, rect);
    assert_eq!(info.name, "Red");
    assert_eq!(
        (info.x, info.y, info.width, info.height),
        (10.0, 20.0, 100.0, 50.0)
    );
    assert_eq!(info.fills.len(), 1);
    assert_eq!(info.fills[0].color.as_deref(), Some("FF0000"));
    // The frame is not turned: a move on the page moves x and y as much.
    assert_eq!(info.panel_move, [1.0, 0.0, 0.0, 1.0]);
}

#[test]
fn maps_page_moves_into_a_turned_frame() {
    let (mut doc, _) = open();
    let ops: Vec<crate::edit::Op> =
        serde_json::from_str(r#"[{"op":"set","ids":["1:2"],"props":{"rotation":90}}]"#).unwrap();
    crate::edit::History::default()
        .apply(&mut doc, &ops, None)
        .unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let info = node_info(&doc, &scene, scene.find(&doc, "1:3").unwrap());
    let [a, b, c, d] = info.panel_move;
    // Moving the layer right on the page moves it along the frame's turned
    // axes; the panel's x and y follow the frame.
    let (dx, dy) = (a * 10.0 + b * 0.0, c * 10.0 + d * 0.0);
    assert!(
        (dx.abs() + dy.abs() - 10.0).abs() < 1e-9 && dx.abs() < 1e-9,
        "{dx}, {dy}"
    );
}

#[test]
fn finds_layers_in_a_marquee() {
    let (doc, scene) = open();
    let frame = scene.find(&doc, "1:2").unwrap();
    let inside = in_rect(
        &doc,
        &scene,
        frame,
        &crate::model::Rect::new(0.0, 0.0, 120.0, 80.0),
    );
    assert_eq!(inside, [scene.find(&doc, "1:3").unwrap()]);
}
