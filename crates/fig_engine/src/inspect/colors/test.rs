use super::page_colors;
use crate::document::Document;
use crate::edit::{History, Op};
use crate::scene::Scene;
use crate::testing::simple_file;

#[test]
fn lists_distinct_colors_most_used_first() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"create","parent":"1:2","node":{"type":"RECTANGLE","x":0,"y":0,"width":10,"height":10,
        "props":{"fills":[{"color":"FF0000"},{"color":"00FF0080"},{"color":"0000FF","visible":false}]}}}]"#,
    )
    .unwrap();
    History::default().apply(&mut doc, &ops, None).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    // White (the frame) once, red twice, the hidden blue not at all.
    assert_eq!(
        page_colors(&doc, &scene, 10),
        vec!["FF0000", "FFFFFF", "00FF0080"]
    );
    assert_eq!(page_colors(&doc, &scene, 1), vec!["FF0000"]);
}
