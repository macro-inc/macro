use super::*;
use crate::scene::Scene;
use crate::testing::simple_file;

fn open() -> (Document, History) {
    (Document::open(&simple_file()).unwrap(), History::default())
}

fn ops(json: &str) -> Vec<Op> {
    serde_json::from_str(json).unwrap()
}

fn origin(doc: &Document, id: &str) -> Vec2 {
    let i = doc.find(Guid::parse(id).unwrap()).unwrap();
    doc.world(i).apply(Vec2::default())
}

fn names(doc: &Document, parent: &str) -> Vec<String> {
    let p = doc.find(Guid::parse(parent).unwrap()).unwrap();
    doc.node(p)
        .children
        .iter()
        .map(|&c| doc.props(c).name().to_owned())
        .collect()
}

#[test]
fn translates_and_undoes() {
    let (mut doc, mut h) = open();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"translate","ids":["1:3"],"dx":5,"dy":-4}]"#),
        None,
    )
    .unwrap();
    assert_eq!(origin(&doc, "1:3"), Vec2::new(15.0, 16.0));
    let rect = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    assert!(doc.node(rect).edits & flags::TRANSFORM != 0);
    h.undo(&mut doc).unwrap();
    assert_eq!(origin(&doc, "1:3"), Vec2::new(10.0, 20.0));
    assert_eq!(doc.node(rect).edits, 0, "undo clears the edit");
    h.redo(&mut doc).unwrap();
    assert_eq!(origin(&doc, "1:3"), Vec2::new(15.0, 16.0));
}

#[test]
fn coalesces_drags_into_one_step() {
    let (mut doc, mut h) = open();
    for _ in 0..5 {
        h.apply(
            &mut doc,
            &ops(r#"[{"op":"translate","ids":["1:3"],"dx":1,"dy":0}]"#),
            Some("drag-1"),
        )
        .unwrap();
    }
    assert_eq!(origin(&doc, "1:3").x, 15.0);
    h.undo(&mut doc).unwrap();
    assert_eq!(origin(&doc, "1:3").x, 10.0);
    assert!(!h.can_undo());
}

#[test]
fn sets_properties() {
    let (mut doc, mut h) = open();
    h.apply(
        &mut doc,
        &ops(
            r#"[{"op":"set","ids":["1:3"],"props":{"name":"Box","x":30,"y":40,"width":60,
            "opacity":0.5,"cornerRadius":8,"fills":[{"color":"00FF00"}],"visible":false}}]"#,
        ),
        None,
    )
    .unwrap();
    let rect = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    let p = doc.props(rect);
    assert_eq!(p.name(), "Box");
    assert_eq!(origin(&doc, "1:3"), Vec2::new(30.0, 40.0));
    assert_eq!(p.size(), Vec2::new(60.0, 50.0));
    assert_eq!(p.opacity(), 0.5);
    assert_eq!(p.radii().top_left, 8.0);
    assert!(!p.visible());
    assert_eq!(
        p.fills()[0].kind,
        crate::model::PaintKind::Solid(parse_hex("00FF00").unwrap())
    );
}

#[test]
fn keeps_paints_it_does_not_rebuild() {
    let (mut doc, mut h) = open();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"set","ids":["1:3"],"props":{"fills":[{"keep":0,"opacity":0.25},{"color":"0000FF80"}]}}]"#),
        None,
    )
    .unwrap();
    let rect = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    let fills = doc.props(rect).fills();
    assert_eq!(fills.len(), 2);
    assert_eq!(fills[0].opacity, 0.25);
    assert!(matches!(fills[0].kind, crate::model::PaintKind::Solid(c) if c.r == 1.0));
    assert!(
        matches!(fills[1].kind, crate::model::PaintKind::Solid(c) if (c.a - 0.502).abs() < 0.01)
    );
}

#[test]
fn creates_layers_in_parent_space() {
    let (mut doc, mut h) = open();
    let applied = h
        .apply(
            &mut doc,
            &ops(r#"[{"op":"create","parent":"1:2","node":{"type":"ELLIPSE","x":50,"y":60,"width":20,"height":10}}]"#),
            None,
        )
        .unwrap();
    let [id] = applied.created.as_slice() else {
        panic!("one layer created");
    };
    assert_eq!(origin(&doc, id), Vec2::new(50.0, 60.0));
    assert_eq!(names(&doc, "1:2"), ["Red", "Ellipse 1"]);
    // Drawn: the new node is in the scene.
    let scene = Scene::build(&doc, doc.pages[0]);
    assert!(scene.find(&doc, id).is_some());
    h.undo(&mut doc).unwrap();
    assert_eq!(names(&doc, "1:2"), ["Red"]);
    let scene = Scene::build(&doc, doc.pages[0]);
    assert!(scene.find(&doc, id).is_none());
}

#[test]
fn deletes_and_restores() {
    let (mut doc, mut h) = open();
    h.apply(&mut doc, &ops(r#"[{"op":"delete","ids":["1:2"]}]"#), None)
        .unwrap();
    assert!(names(&doc, "1:1").is_empty());
    let rect = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    assert!(doc.node(rect).removed, "children go with their parent");
    h.undo(&mut doc).unwrap();
    assert_eq!(names(&doc, "1:1"), ["Frame"]);
    assert!(!doc.node(rect).removed);
}

#[test]
fn duplicates_with_children() {
    let (mut doc, mut h) = open();
    let applied = h
        .apply(
            &mut doc,
            &ops(r#"[{"op":"duplicate","ids":["1:2"],"dx":300,"dy":0}]"#),
            None,
        )
        .unwrap();
    assert_eq!(names(&doc, "1:1"), ["Frame", "Frame"]);
    let copy = &applied.created[0];
    assert_eq!(origin(&doc, copy), Vec2::new(300.0, 0.0));
    assert_eq!(names(&doc, copy), ["Red"]);
    let c = doc.find(Guid::parse(copy).unwrap()).unwrap();
    assert_eq!(doc.node(c).source, Guid::parse("1:2"));
}

#[test]
fn arranges_and_reorders() {
    let (mut doc, mut h) = open();
    let create = |name: &str| {
        format!(
            r#"{{"op":"create","parent":"1:2","node":{{"type":"RECTANGLE","name":"{name}","x":0,"y":0,"width":5,"height":5}}}}"#
        )
    };
    h.apply(
        &mut doc,
        &ops(&format!("[{},{}]", create("A"), create("B"))),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:2"), ["Red", "A", "B"]);
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"arrange","ids":["1:3"],"how":"front"}]"#),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:2"), ["A", "B", "Red"]);
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"arrange","ids":["1:3"],"how":"backward"}]"#),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:2"), ["A", "Red", "B"]);
    // Positions agree with the order, so a reload keeps it.
    let frame = doc.find(Guid::parse("1:2").unwrap()).unwrap();
    let positions: Vec<String> = doc
        .node(frame)
        .children
        .iter()
        .map(|&c| doc.props(c).position.as_deref().unwrap_or("").to_owned())
        .collect();
    let mut sorted = positions.clone();
    sorted.sort();
    assert_eq!(positions, sorted);
    // Out of the frame onto the page, keeping its place on the page.
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"reorder","ids":["1:3"],"parent":"1:1","index":1}]"#),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:1"), ["Frame", "Red"]);
    assert_eq!(origin(&doc, "1:3"), Vec2::new(10.0, 20.0));
}

#[test]
fn groups_and_ungroups_in_place() {
    let (mut doc, mut h) = open();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"create","parent":"1:2","node":{"type":"RECTANGLE","name":"B","x":120,"y":100,"width":10,"height":10}}]"#),
        None,
    )
    .unwrap();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"group","ids":["1:3","2:1"]}]"#),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:2"), ["Group 1"]);
    let frame = doc.find(Guid::parse("1:2").unwrap()).unwrap();
    let group = doc.node(frame).children[0];
    let gid = doc.props(group).guid.unwrap().to_string();
    assert_eq!(names(&doc, &gid), ["Red", "B"]);
    assert_eq!(doc.props(group).size(), Vec2::new(120.0, 90.0));
    assert_eq!(origin(&doc, "1:3"), Vec2::new(10.0, 20.0));
    assert_eq!(origin(&doc, "2:1"), Vec2::new(120.0, 100.0));
    h.apply(
        &mut doc,
        &ops(&format!(r#"[{{"op":"ungroup","ids":["{gid}"]}}]"#)),
        None,
    )
    .unwrap();
    assert_eq!(names(&doc, "1:2"), ["Red", "B"]);
    assert_eq!(origin(&doc, "2:1"), Vec2::new(120.0, 100.0));
}

#[test]
fn rescales_vector_geometry() {
    use crate::testing::{V, fig_file, node, path_blob, size, solid, translate};
    let tri = path_blob(&[
        (1, &[0.0, 0.0]),
        (2, &[10.0, 0.0]),
        (2, &[0.0, 10.0]),
        (0, &[]),
    ]);
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                2,
                Some((1, "!")),
                "VECTOR",
                "Tri",
                vec![
                    ("size", size(10.0, 10.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                    (
                        "fillGeometry",
                        V::List(vec![V::Msg(vec![
                            ("windingRule", V::Enum("NONZERO")),
                            ("commandsBlob", V::Uint(0)),
                        ])]),
                    ),
                ],
            ),
        ],
        vec![tri],
    );
    let mut doc = Document::open(&bytes).unwrap();
    let mut h = History::default();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"set","ids":["1:2"],"props":{"width":30,"height":20}}]"#),
        None,
    )
    .unwrap();
    let i = doc.find(Guid::parse("1:2").unwrap()).unwrap();
    let blob = doc.props(i).fill_geometry()[0].blob;
    assert_eq!(blob, 1, "a new blob");
    let b = doc.blobs.path(blob).unwrap().bounds();
    assert_eq!((b.w, b.h), (30.0, 20.0));
}

#[test]
fn rejects_instance_sublayers_without_changing_anything() {
    let (mut doc, mut h) = open();
    let err = h.apply(
        &mut doc,
        &ops(r#"[{"op":"translate","ids":["1:3"],"dx":1,"dy":1},{"op":"set","ids":["I1:2;1:3"],"props":{"name":"x"}}]"#),
        None,
    );
    assert!(err.is_err());
    assert_eq!(origin(&doc, "1:3"), Vec2::new(10.0, 20.0), "rolled back");
    assert!(!h.can_undo());
}

#[test]
fn fractional_positions_sort_between() {
    let cases = [
        ("", None),
        ("a", None),
        ("a", Some("b")),
        ("a", Some("a\"")),
        ("!", Some("#")),
        ("~", None),
        ("", Some("\"")),
        ("a!", Some("a!!O")),
    ];
    for (lo, hi) in cases {
        let p = between(lo, hi).unwrap_or_else(|| panic!("room between {lo:?} and {hi:?}"));
        assert!(p.as_str() > lo, "{p:?} > {lo:?}");
        if let Some(h) = hi {
            assert!(p.as_str() < h, "{p:?} < {h:?}");
        }
        assert!(p.bytes().all(|c| (b'!'..=b'~').contains(&c)), "{p:?}");
    }
    // No string sorts between these.
    for (lo, hi) in [("a", "a!"), ("", "!"), ("b", "a"), ("a", "a")] {
        assert_eq!(between(lo, Some(hi)), None, "{lo:?} {hi:?}");
    }
}

#[test]
fn pastes_cut_layers_where_they_were() {
    let (mut doc, mut h) = open();
    h.apply(&mut doc, &ops(r#"[{"op":"delete","ids":["1:3"]}]"#), None)
        .unwrap();
    assert!(names(&doc, "1:2").is_empty());
    let pasted = h
        .apply(
            &mut doc,
            &ops(r#"[{"op":"duplicate","ids":["1:3"]}]"#),
            None,
        )
        .unwrap();
    assert_eq!(names(&doc, "1:2"), ["Red"]);
    assert_eq!(origin(&doc, &pasted.created[0]), Vec2::new(10.0, 20.0));
}

#[test]
fn adds_renames_and_removes_pages() {
    let (mut doc, mut h) = open();
    let added = h
        .apply(
            &mut doc,
            &ops(r#"[{"op":"create","parent":"1:0","node":{"type":"CANVAS","x":0,"y":0,"width":0,"height":0}}]"#),
            None,
        )
        .unwrap();
    assert_eq!(doc.pages.len(), 2);
    let id = &added.created[0];
    assert_eq!(doc.props(doc.pages[1]).name(), "Page 2");
    h.apply(
        &mut doc,
        &ops(&format!(r#"[{{"op":"set","ids":["{id}"],"props":{{"name":"Flows","fills":[{{"color":"1E1E1E"}}]}}}}]"#)),
        None,
    )
    .unwrap();
    assert_eq!(doc.props(doc.pages[1]).name(), "Flows");
    assert!(doc.page_background(doc.pages[1]).r < 0.2);
    h.apply(
        &mut doc,
        &ops(&format!(r#"[{{"op":"delete","ids":["{id}","1:1"]}}]"#)),
        None,
    )
    .unwrap();
    assert_eq!(doc.pages.len(), 1, "the last page stays");
    h.undo(&mut doc).unwrap();
    assert_eq!(doc.pages.len(), 2);
}

#[test]
fn edits_effects() {
    let (mut doc, mut h) = open();
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"set","ids":["1:3"],"props":{"effects":[{}]}}]"#),
        None,
    )
    .unwrap();
    let rect = doc.find(Guid::parse("1:3").unwrap()).unwrap();
    let e = doc.props(rect).effects()[0].clone();
    assert_eq!(e.kind, EffectKind::DropShadow);
    assert_eq!(e.offset, Vec2::new(0.0, 4.0));
    h.apply(
        &mut doc,
        &ops(r#"[{"op":"set","ids":["1:3"],"props":{"effects":[{"keep":0,"y":8,"radius":12,"color":"FF000080"},{"type":"LAYER_BLUR","radius":2}]}}]"#),
        None,
    )
    .unwrap();
    let effects = doc.props(rect).effects().to_vec();
    assert_eq!(effects.len(), 2);
    assert_eq!(effects[0].offset.y, 8.0);
    assert_eq!(effects[0].radius, 12.0);
    assert!((effects[0].color.a - 0.5).abs() < 0.01);
    assert_eq!(effects[1].kind, EffectKind::LayerBlur);
    let saved = crate::save::save(&doc, &simple_file()).unwrap();
    let reopened = Document::open(&saved).unwrap();
    let r = reopened.find(Guid::parse("1:3").unwrap()).unwrap();
    assert_eq!(reopened.props(r).effects().len(), 2);
}

#[test]
fn steps_keep_their_ids_through_coalescing_undo_and_redo() {
    let (mut doc, mut h) = open();
    let nudge = ops(r#"[{"op":"translate","ids":["1:3"],"dx":1,"dy":0}]"#);
    assert_eq!(h.undo_step(), None);
    h.apply(&mut doc, &nudge, None).unwrap();
    let first = h.undo_step().unwrap();
    // A drag's steps are one step, with one id.
    h.apply(&mut doc, &nudge, Some("drag")).unwrap();
    let drag = h.undo_step().unwrap();
    assert_ne!(drag, first);
    h.apply(&mut doc, &nudge, Some("drag")).unwrap();
    assert_eq!(h.undo_step(), Some(drag));
    h.undo(&mut doc).unwrap();
    assert_eq!((h.undo_step(), h.redo_step()), (Some(first), Some(drag)));
    h.redo(&mut doc).unwrap();
    assert_eq!((h.undo_step(), h.redo_step()), (Some(drag), None));
}
