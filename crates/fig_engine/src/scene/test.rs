use super::*;
use crate::testing::{V, fig_file, guid, node, simple_file, size, solid, translate};

/// A page with a blue "Button" component (a rectangle "Bg" inside) and an
/// instance of it at (200, 0) whose "Bg" fill is overridden to green.
pub(crate) fn instance_file() -> Vec<u8> {
    fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                10,
                Some((1, "a")),
                "SYMBOL",
                "Button",
                vec![
                    ("size", size(80.0, 30.0)),
                    ("transform", translate(0.0, 0.0)),
                ],
            ),
            node(
                11,
                Some((10, "a")),
                "RECTANGLE",
                "Bg",
                vec![
                    ("size", size(80.0, 30.0)),
                    ("transform", translate(0.0, 0.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 1.0)])),
                ],
            ),
            node(
                20,
                Some((1, "b")),
                "INSTANCE",
                "Button",
                vec![
                    ("size", size(80.0, 30.0)),
                    ("transform", translate(200.0, 0.0)),
                    (
                        "symbolData",
                        V::Msg(vec![
                            ("symbolID", guid(10)),
                            (
                                "symbolOverrides",
                                V::List(vec![V::Msg(vec![
                                    ("guidPath", V::Msg(vec![("guids", V::List(vec![guid(11)]))])),
                                    ("fillPaints", V::List(vec![solid(0.0, 1.0, 0.0)])),
                                ])]),
                            ),
                        ]),
                    ),
                ],
            ),
        ],
        vec![],
    )
}

#[test]
fn places_nodes_in_page_space() {
    let doc = Document::open(&simple_file()).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let rect = scene.find(&doc, "1:3").unwrap();
    let b = scene.node(rect).bounds;
    assert_eq!((b.x, b.y, b.w, b.h), (10.0, 20.0, 100.0, 50.0));
    let frame = scene.find(&doc, "1:2").unwrap();
    assert_eq!(scene.node(rect).parent, Some(frame));
    assert_eq!(scene.ancestry(rect), [frame, rect]);
    assert_eq!(scene.id(&doc, rect), "1:3");
}

#[test]
fn expands_instances_with_overrides() {
    let doc = Document::open(&instance_file()).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    let instance = scene.find(&doc, "1:20").unwrap();
    let [child] = scene.node(instance).children[..] else {
        panic!("the instance has the component's one child");
    };
    assert_eq!(scene.id(&doc, child), "I1:20;1:11");
    assert_eq!(scene.find(&doc, "I1:20;1:11"), Some(child));
    let props = scene.props(&doc, child);
    assert_eq!(props.name.as_deref(), Some("Bg"));
    let fill = props.fills.as_deref().and_then(|f| f.first()).unwrap();
    assert!(matches!(fill.kind, crate::model::PaintKind::Solid(c) if c.g == 1.0 && c.b == 0.0));
    // Placed relative to the instance.
    let b = scene.node(child).bounds;
    assert_eq!((b.x, b.y), (200.0, 0.0));
    // The component itself is untouched.
    let original = scene.find(&doc, "1:11").unwrap();
    let fill = scene.props(&doc, original).fills.as_deref().unwrap()[0].clone();
    assert!(matches!(fill.kind, crate::model::PaintKind::Solid(c) if c.b == 1.0));
}

#[test]
fn survives_an_instance_of_itself() {
    // A component containing an instance of itself must not recurse forever.
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                10,
                Some((1, "a")),
                "SYMBOL",
                "Loop",
                vec![("size", size(10.0, 10.0))],
            ),
            node(
                11,
                Some((10, "a")),
                "INSTANCE",
                "Inner",
                vec![
                    ("size", size(10.0, 10.0)),
                    ("symbolData", V::Msg(vec![("symbolID", guid(10))])),
                ],
            ),
        ],
        vec![],
    );
    let doc = Document::open(&bytes).unwrap();
    let scene = Scene::build(&doc, doc.pages[0]);
    assert!(scene.nodes.len() < 200);
}

#[test]
fn refreshes_in_place_after_property_edits() {
    use crate::edit::{History, Op};
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut scene = Scene::build(&doc, doc.pages[0]);
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"translate","ids":["1:2"],"dx":10,"dy":5},{"op":"set","ids":["1:3"],"props":{"width":40}}]"#,
    )
    .unwrap();
    let applied = History::default().apply(&mut doc, &ops, None).unwrap();
    assert!(scene.refresh(&doc, &applied.touched));
    let fresh = Scene::build(&doc, doc.pages[0]);
    for (a, b) in scene.nodes.iter().zip(&fresh.nodes) {
        assert_eq!(a.world, b.world);
        assert_eq!(a.bounds, b.bounds);
    }
    // Adding a layer needs a rebuild.
    let ops: Vec<Op> = serde_json::from_str(
        r#"[{"op":"create","parent":"1:2","node":{"type":"RECTANGLE","x":0,"y":0,"width":5,"height":5}}]"#,
    )
    .unwrap();
    let applied = History::default().apply(&mut doc, &ops, None).unwrap();
    assert!(!scene.refresh(&doc, &applied.touched));
}

#[test]
fn moves_instances_and_components_in_place() {
    use crate::edit::{History, Op};
    use crate::save::blank;
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let apply = |doc: &mut Document, h: &mut History, json: &str| {
        let ops: Vec<Op> = serde_json::from_str(json).unwrap();
        h.apply(doc, &ops, None).unwrap()
    };
    let frame = apply(
        &mut doc,
        &mut h,
        r#"[{"op":"create","parent":"0:1","node":{"type":"FRAME","x":0,"y":0,"width":50,"height":50}}]"#,
    )
    .created[0]
    .clone();
    let rect = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"create","parent":"{frame}","node":{{"type":"RECTANGLE","x":5,"y":5,"width":10,"height":10}}}},
                {{"op":"createComponent","ids":["{frame}"]}}]"#
        ),
    )
    .created[0]
    .clone();
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"instantiate","component":"{frame}","parent":"0:1","x":100,"y":0}}]"#),
    )
    .created[0]
        .clone();
    let page = doc.pages[0];
    let mut scene = Scene::build(&doc, page);
    // Moving the component or the instance keeps the scene.
    let applied = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"translate","ids":["{frame}","{instance}"],"dx":7,"dy":3}}]"#),
    );
    assert!(scene.refresh(&doc, &applied.touched));
    let fresh = Scene::build(&doc, page);
    for (a, b) in scene.nodes.iter().zip(&fresh.nodes) {
        assert_eq!(a.world, b.world);
        assert_eq!(a.bounds, b.bounds);
    }
    // Overriding a layer in the instance, or editing the component's
    // layers, changes what the instance shows: rebuild.
    let applied = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["I{instance};{rect}"],"props":{{"opacity":0.5}}}}]"#),
    );
    assert!(!scene.refresh(&doc, &applied.touched));
    let mut scene = Scene::build(&doc, page);
    let applied = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{rect}"],"props":{{"opacity":0.5}}}}]"#),
    );
    assert!(!scene.refresh(&doc, &applied.touched));
}
