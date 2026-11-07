use super::*;
use crate::edit::{History, Op};
use crate::model::{Guid, PaintKind};
use crate::testing::simple_file;

fn ops(json: &str) -> Vec<Op> {
    serde_json::from_str(json).unwrap()
}

fn apply(doc: &mut Document, h: &mut History, json: &str) -> Vec<String> {
    h.apply(doc, &ops(json), None).unwrap().created
}

fn idx(doc: &Document, id: &str) -> NodeIdx {
    doc.find(Guid::parse(id).unwrap()).unwrap()
}

/// Page bounds of a layer's frame.
fn frame(doc: &Document, id: &str) -> crate::model::Rect {
    let i = idx(doc, id);
    let s = doc.props(i).size();
    doc.world(i)
        .map_rect(&crate::model::Rect::new(0.0, 0.0, s.x, s.y))
}

/// Whether the boolean's outline covers a page point.
fn covers(doc: &Document, id: &str, x: f64, y: f64) -> bool {
    let i = idx(doc, id);
    let local = doc.world(i).invert().unwrap().apply(Vec2::new(x, y));
    doc.props(i).fill_geometry().iter().any(|g| {
        doc.blobs
            .path(g.blob)
            .is_some_and(|p| p.contains(local, g.winding))
    })
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

/// The simple file's red rectangle (10, 20, 100 × 50) and an ellipse at
/// (60, 40), 60 × 60, both in the frame; returns the ellipse's id.
fn with_ellipse(doc: &mut Document, h: &mut History) -> String {
    apply(
        doc,
        h,
        r#"[{"op":"create","parent":"1:2","node":{"type":"ELLIPSE","x":60,"y":40,"width":60,"height":60,
            "props":{"fills":[{"color":"0000FF"}]}}}]"#,
    )
    .remove(0)
}

#[test]
fn combines_layers_into_a_boolean() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let ellipse = with_ellipse(&mut doc, &mut h);
    let created = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"boolean","ids":["1:3","{ellipse}"],"operation":"UNION"}}]"#),
    );
    let b = &created[0];
    let bi = idx(&doc, b);
    let p = doc.props(bi);
    assert_eq!(p.node_type(), NodeType::BooleanOperation);
    assert_eq!(p.boolean_operation.as_deref(), Some("UNION"));
    assert_eq!(p.name(), "Union");
    // The bottom layer's fill.
    assert!(matches!(p.fills()[0].kind, PaintKind::Solid(c) if c.r == 1.0 && c.b == 0.0));
    let names: Vec<&str> = doc
        .node(bi)
        .children
        .iter()
        .map(|&c| doc.props(c).name())
        .collect();
    assert_eq!(names, ["Red", "Ellipse 1"]);
    let r = frame(&doc, b);
    assert!(close(r.x, 10.0) && close(r.y, 20.0) && close(r.w, 110.0) && close(r.h, 80.0));
    // The operands stay where they were on the page.
    let red = frame(&doc, "1:3");
    assert!(close(red.x, 10.0) && close(red.y, 20.0));
    assert!(covers(&doc, b, 20.0, 30.0) && covers(&doc, b, 90.0, 90.0));
    assert!(!covers(&doc, b, 20.0, 90.0));
}

#[test]
fn subtracts_and_undoes() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let ellipse = with_ellipse(&mut doc, &mut h);
    let b = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"boolean","ids":["{ellipse}","1:3"],"operation":"SUBTRACT"}}]"#),
    )
    .remove(0);
    assert!(covers(&doc, &b, 20.0, 30.0));
    assert!(!covers(&doc, &b, 90.0, 60.0), "the ellipse is cut out");
    // Subtracting keeps the bottom layer's box.
    let r = frame(&doc, &b);
    assert!(close(r.w, 100.0) && close(r.h, 50.0));
    h.undo(&mut doc).unwrap();
    let red = idx(&doc, "1:3");
    assert_eq!(doc.node(red).parent, Some(idx(&doc, "1:2")));
    assert!(doc.node(idx(&doc, &b)).removed);
}

#[test]
fn refits_when_an_operand_changes() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let ellipse = with_ellipse(&mut doc, &mut h);
    let b = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"boolean","ids":["1:3","{ellipse}"],"operation":"UNION"}}]"#),
    )
    .remove(0);
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"translate","ids":["{ellipse}"],"dx":100,"dy":0}}]"#),
    );
    let r = frame(&doc, &b);
    assert!(close(r.x, 10.0) && close(r.w, 210.0), "{r:?}");
    assert!(covers(&doc, &b, 190.0, 70.0) && !covers(&doc, &b, 90.0, 90.0));
    // A lone boolean takes another operation.
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"translate","ids":["{ellipse}"],"dx":-100,"dy":0}},
                     {{"op":"boolean","ids":["{b}"],"operation":"INTERSECT"}}]"#
        ),
    );
    let p = doc.props(idx(&doc, &b));
    assert_eq!(p.boolean_operation.as_deref(), Some("INTERSECT"));
    let r = frame(&doc, &b);
    assert!(close(r.x, 60.0) && close(r.y, 40.0) && close(r.w, 50.0) && close(r.h, 30.0));
}

#[test]
fn saves_booleans_figma_reads() {
    let original = crate::save::blank("Shapes");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let created = apply(
        &mut doc,
        &mut h,
        r#"[{"op":"create","parent":"0:1","node":{"type":"RECTANGLE","x":10,"y":20,"width":100,"height":50}},
            {"op":"create","parent":"0:1","node":{"type":"ELLIPSE","x":60,"y":40,"width":60,"height":60}}]"#,
    );
    let b = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"boolean","ids":["{}","{}"],"operation":"XOR"}}]"#,
            created[0], created[1]
        ),
    )
    .remove(0);
    let saved = crate::save::save(&doc, &original).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let bp = reopened.props(idx(&reopened, &b));
    assert_eq!(bp.node_type(), NodeType::BooleanOperation);
    assert_eq!(bp.boolean_operation.as_deref(), Some("XOR"));
    assert_eq!(bp.fill_geometry().len(), 1);
    assert_eq!(reopened.node(idx(&reopened, &b)).children.len(), 2);
    assert!(covers(&reopened, &b, 20.0, 30.0) && !covers(&reopened, &b, 80.0, 55.0));
}

#[test]
fn saves_vectors_figma_reads() {
    let original = simple_file();
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let v = apply(
        &mut doc,
        &mut h,
        r#"[{"op":"createVector","parent":"1:1","network":{
            "vertices":[{"x":300,"y":10},{"x":360,"y":10},{"x":360,"y":70}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2,"tangentStart":{"x":20,"y":0},"tangentEnd":{"x":0,"y":-20}}]}}]"#,
    )
    .remove(0);
    // The test schema has no `vectorData`: saving adds it.
    let saved = crate::save::save(&doc, &original).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let vp = reopened.props(idx(&reopened, &v));
    assert_eq!(vp.node_type(), NodeType::Vector);
    let net = crate::vector::node_network(&reopened, vp).unwrap();
    assert_eq!(net.vertices.len(), 3);
    assert_eq!(net.segments[1].tangent_start.x, 20.0);
    assert!(!vp.stroke_geometry().is_empty() && vp.fill_geometry().is_empty());
    // And the untouched rectangle reads as before.
    assert_eq!(reopened.props(idx(&reopened, "1:3")).name(), "Red");
}

#[test]
fn draws_vectors_from_the_pen_and_edits_their_points() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let v = apply(
        &mut doc,
        &mut h,
        r#"[{"op":"createVector","parent":"1:2","network":{
            "vertices":[{"x":20,"y":30},{"x":80,"y":30},{"x":80,"y":90}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2}]}}]"#,
    )
    .remove(0);
    let r = frame(&doc, &v);
    assert!(close(r.x, 20.0) && close(r.y, 30.0) && close(r.w, 60.0) && close(r.h, 60.0));
    let p = doc.props(idx(&doc, &v));
    assert_eq!(p.name(), "Vector 1");
    assert!(p.fills().is_empty() && p.strokes().len() == 1);
    assert!(p.fill_geometry().is_empty() && p.stroke_geometry().len() == 1);
    // Dragging the first point up and left moves the layer's origin.
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"setVector","id":"{v}","network":{{
            "vertices":[{{"x":0,"y":0}},{{"x":80,"y":30}},{{"x":80,"y":90}}],
            "segments":[{{"start":0,"end":1}},{{"start":1,"end":2}}]}}}}]"#
        ),
    );
    let r = frame(&doc, &v);
    assert!(close(r.x, 0.0) && close(r.y, 0.0) && close(r.w, 80.0) && close(r.h, 90.0));
    // A thicker stroke is drawn again from the network.
    let before = doc
        .blobs
        .path(doc.props(idx(&doc, &v)).stroke_geometry()[0].blob)
        .unwrap()
        .bounds();
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{v}"],"props":{{"strokeWeight":6}}}}]"#),
    );
    let after = doc
        .blobs
        .path(doc.props(idx(&doc, &v)).stroke_geometry()[0].blob)
        .unwrap()
        .bounds();
    assert!(
        after.w > before.w + 2.0 && after.h > before.h + 2.0,
        "{before:?} {after:?}"
    );
}

#[test]
fn editing_a_shapes_points_makes_it_a_vector() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setVector","id":"1:3","network":{
            "vertices":[{"x":10,"y":20},{"x":110,"y":20},{"x":60,"y":70}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2},{"start":2,"end":0}],
            "regions":[{"windingRule":"NONZERO","loops":[[0,1,2]]}]}}]"#,
    );
    let p = doc.props(idx(&doc, "1:3"));
    assert_eq!(p.node_type(), NodeType::Vector);
    assert_eq!(p.fill_geometry().len(), 1);
    // It keeps its red fill.
    assert!(matches!(p.fills()[0].kind, PaintKind::Solid(c) if c.r == 1.0));
}

#[test]
fn flattens_layers_into_one_vector() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    let ellipse = with_ellipse(&mut doc, &mut h);
    apply(&mut doc, &mut h, r#"[{"op":"flatten","ids":["1:3"]}]"#);
    let frame_i = idx(&doc, "1:2");
    let red = doc.node(frame_i).children[0];
    let p = doc.props(red);
    assert_eq!(p.node_type(), NodeType::Vector);
    assert_eq!(p.name(), "Red");
    let net = crate::vector::node_network(&doc, p).unwrap();
    assert_eq!(net.vertices.len(), 4);
    let id = p.guid.unwrap().to_string();
    let r = frame(&doc, &id);
    assert!(close(r.x, 10.0) && close(r.y, 20.0) && close(r.w, 100.0) && close(r.h, 50.0));
    // Several layers become one, where the topmost was.
    let created = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"flatten","ids":["{id}","{ellipse}"]}}]"#),
    );
    assert_eq!(doc.node(frame_i).children.len(), 1);
    let r = frame(&doc, &created[0]);
    assert!(close(r.w, 110.0) && close(r.h, 80.0));
}
