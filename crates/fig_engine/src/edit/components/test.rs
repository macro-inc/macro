use super::super::{History, Op};
use crate::document::{Document, NodeIdx};
use crate::model::{Guid, NodeType, PaintKind};
use crate::save::{blank, save};
use crate::scene::Scene;

fn apply(doc: &mut Document, h: &mut History, json: &str) -> Vec<String> {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    h.apply(doc, &ops, None).unwrap().created
}

fn idx(doc: &Document, id: &str) -> NodeIdx {
    doc.find(Guid::parse(id).unwrap()).unwrap()
}

/// A "Button" frame holding a red "Fill" rectangle, made a component.
fn button(doc: &mut Document, h: &mut History) -> (String, String) {
    let frame = apply(
        doc,
        h,
        r#"[{"op":"create","parent":"0:1","node":{"type":"FRAME","name":"Button","x":0,"y":0,"width":100,"height":40}}]"#,
    )[0]
    .clone();
    let fill = apply(
        doc,
        h,
        &format!(
            r#"[{{"op":"create","parent":"{frame}","node":{{"type":"RECTANGLE","name":"Fill","x":10,"y":10,"width":20,"height":20,"props":{{"fills":[{{"color":"FF0000"}}]}}}}}},
                {{"op":"createComponent","ids":["{frame}"]}}]"#
        ),
    )[0]
    .clone();
    (frame, fill)
}

/// The scene node drawing the instance's copy of `layer`.
fn sublayer(doc: &Document, instance: &str, layer: &str) -> crate::model::Props {
    let page = doc.pages[0];
    let scene = Scene::build(doc, page);
    let i = scene
        .find(doc, &format!("I{instance};{layer}"))
        .expect("sublayer");
    scene.props(doc, i).clone()
}

#[test]
fn makes_components_and_instances() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (component, fill) = button(&mut doc, &mut h);
    assert_eq!(
        doc.props(idx(&doc, &component)).node_type(),
        NodeType::Symbol
    );
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"instantiate","component":"{component}","parent":"0:1","x":200,"y":0}}]"#
        ),
    )[0]
    .clone();
    let i = idx(&doc, &instance);
    assert_eq!(doc.props(i).node_type(), NodeType::Instance);
    assert_eq!(doc.props(i).name(), "Button");
    assert!(
        doc.node(i).children.is_empty(),
        "instances draw the component"
    );
    // Editing the component shows in the instance.
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{fill}"],"props":{{"fills":[{{"color":"0000FF"}}]}}}}]"#),
    );
    let p = sublayer(&doc, &instance, &fill);
    assert!(matches!(p.fills()[0].kind, PaintKind::Solid(c) if c.b == 1.0));
    // Saved and reopened, it is still an instance of the component.
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let ri = idx(&reopened, &instance);
    assert_eq!(reopened.props(ri).node_type(), NodeType::Instance);
    assert_eq!(
        reopened.props(ri).symbol.as_ref().and_then(|s| s.symbol_id),
        Guid::parse(&component)
    );
    assert_eq!(
        reopened.props(idx(&reopened, &component)).node_type(),
        NodeType::Symbol
    );
    sublayer(&reopened, &instance, &fill);
}

#[test]
fn duplicating_a_component_makes_an_instance() {
    let mut doc = Document::open(&blank("x")).unwrap();
    let mut h = History::default();
    let (component, _) = button(&mut doc, &mut h);
    let copy = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"duplicate","ids":["{component}"],"dx":0,"dy":60}}]"#),
    )[0]
    .clone();
    let c = idx(&doc, &copy);
    assert_eq!(doc.props(c).node_type(), NodeType::Instance);
    assert_eq!(doc.props(c).transform().m12, 60.0);
    // Cut and pasted, the component stays itself.
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"delete","ids":["{component}"]}}]"#),
    );
    let pasted = apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"duplicate","ids":["{component}"]}}]"#),
    )[0]
    .clone();
    assert_eq!(doc.props(idx(&doc, &pasted)).node_type(), NodeType::Symbol);
}

#[test]
fn detaches_instances() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (component, _) = button(&mut doc, &mut h);
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"instantiate","component":"{component}","parent":"0:1","x":200,"y":0}}]"#
        ),
    )[0]
    .clone();
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"detach","ids":["{instance}"]}}]"#),
    );
    let i = idx(&doc, &instance);
    assert_eq!(doc.props(i).node_type(), NodeType::Frame);
    assert!(doc.props(i).symbol.is_none());
    let kids = &doc.node(i).children;
    assert_eq!(kids.len(), 1);
    assert_eq!(doc.props(kids[0]).name(), "Fill");
    assert_eq!(doc.props(kids[0]).transform().m02, 10.0);
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let ri = idx(&reopened, &instance);
    assert_eq!(reopened.props(ri).node_type(), NodeType::Frame);
    assert_eq!(reopened.node(ri).children.len(), 1);
    // Undo brings the instance back.
    h.undo(&mut doc).unwrap();
    let i = idx(&doc, &instance);
    assert_eq!(doc.props(i).node_type(), NodeType::Instance);
    assert!(doc.node(i).children.is_empty());
}

#[test]
fn overrides_layers_inside_instances() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (component, fill) = button(&mut doc, &mut h);
    let label = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"create","parent":"{component}","node":{{"type":"TEXT","name":"Label","x":40,"y":10,"width":1,"height":1,"props":{{"characters":"OK","fontSize":12}}}}}}]"#
        ),
    )[0]
    .clone();
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"instantiate","component":"{component}","parent":"0:1","x":200,"y":0}}]"#
        ),
    )[0]
    .clone();
    let ok_width = sublayer(&doc, &instance, &label).size().x;
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["I{instance};{fill}"],"props":{{"fills":[{{"color":"00FF00"}}]}}}},
                {{"op":"set","ids":["I{instance};{label}"],"props":{{"characters":"Continue","name":"CTA"}}}}]"#
        ),
    );
    let f = sublayer(&doc, &instance, &fill);
    assert!(matches!(f.fills()[0].kind, PaintKind::Solid(c) if c.g == 1.0 && c.r == 0.0));
    let l = sublayer(&doc, &instance, &label);
    assert_eq!(
        l.text_content.as_ref().unwrap().characters.as_ref(),
        "Continue"
    );
    assert!(l.size().x > ok_width);
    // The component is untouched.
    let main_fill = doc.props(idx(&doc, &fill));
    assert!(matches!(main_fill.fills()[0].kind, PaintKind::Solid(c) if c.r == 1.0));
    // Saved and reopened, the overrides hold.
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let l = sublayer(&reopened, &instance, &label);
    assert_eq!(
        l.text_content.as_ref().unwrap().characters.as_ref(),
        "Continue"
    );
    assert_eq!(l.name(), "CTA");
    let f = sublayer(&reopened, &instance, &fill);
    assert!(matches!(f.fills()[0].kind, PaintKind::Solid(c) if c.g == 1.0));
    // A second edit updates the same override.
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["I{instance};{label}"],"props":{{"characters":"Go"}}}}]"#),
    );
    let i = idx(&doc, &instance);
    assert_eq!(doc.props(i).symbol.as_ref().unwrap().overrides.len(), 2);
    h.undo(&mut doc).unwrap();
    h.undo(&mut doc).unwrap();
    let l = sublayer(&doc, &instance, &label);
    assert_eq!(l.text_content.as_ref().unwrap().characters.as_ref(), "OK");
}

#[test]
fn resized_instances_follow_constraints() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (component, fill) = button(&mut doc, &mut h);
    // The fill keeps to the right and stretches vertically.
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["{fill}"],"props":{{"constraintHorizontal":"MAX","constraintVertical":"STRETCH"}}}}]"#
        ),
    );
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"instantiate","component":"{component}","parent":"0:1","x":200,"y":0}}]"#
        ),
    )[0]
    .clone();
    let nodes = doc.nodes.len();
    apply(
        &mut doc,
        &mut h,
        &format!(r#"[{{"op":"set","ids":["{instance}"],"props":{{"width":200,"height":80}}}}]"#),
    );
    assert_eq!(
        doc.nodes.len(),
        nodes,
        "the layout's temporary layers are gone"
    );
    let f = sublayer(&doc, &instance, &fill);
    assert_eq!(f.transform().m02, 110.0, "kept 70 from the right");
    assert_eq!(f.size(), crate::model::Vec2::new(20.0, 60.0));
    // The component is unchanged, and the layout is saved.
    assert_eq!(doc.props(idx(&doc, &fill)).transform().m02, 10.0);
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    let f = sublayer(&reopened, &instance, &fill);
    assert_eq!(f.transform().m02, 110.0);
    assert_eq!(f.size().y, 60.0);
}

#[test]
fn longer_labels_grow_hugging_instances() {
    let original = blank("x");
    let mut doc = Document::open(&original).unwrap();
    let mut h = History::default();
    let (component, fill) = button(&mut doc, &mut h);
    let label = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"create","parent":"{component}","node":{{"type":"TEXT","name":"Label","x":40,"y":10,"width":1,"height":1,"props":{{"characters":"OK","fontSize":12}}}}}},
                {{"op":"autoLayout","ids":["{component}"]}}]"#
        ),
    )[0]
    .clone();
    let main_w = doc.props(idx(&doc, &component)).size().x;
    let instance = apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"instantiate","component":"{component}","parent":"0:1","x":300,"y":0}}]"#
        ),
    )[0]
    .clone();
    assert_eq!(doc.props(idx(&doc, &instance)).size().x, main_w);
    apply(
        &mut doc,
        &mut h,
        &format!(
            r#"[{{"op":"set","ids":["I{instance};{label}"],"props":{{"characters":"Continue to checkout"}}}}]"#
        ),
    );
    let grown = doc.props(idx(&doc, &instance)).size().x;
    assert!(grown > main_w + 40.0, "{grown} vs {main_w}");
    // The component keeps its size; the label sits after the fill.
    assert_eq!(doc.props(idx(&doc, &component)).size().x, main_w);
    let f = sublayer(&doc, &instance, &fill);
    let l = sublayer(&doc, &instance, &label);
    assert!(l.transform().m02 >= f.transform().m02 + 20.0);
    let reopened = Document::open(&save(&doc, &original).unwrap()).unwrap();
    assert_eq!(reopened.props(idx(&reopened, &instance)).size().x, grown);
}
