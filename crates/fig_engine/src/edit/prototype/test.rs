use crate::document::Document;
use crate::edit::{History, Op, flags};
use crate::inspect::prototype::{PrototypeInfo, prototype};
use crate::kiwi::{Decoder, Schema};
use crate::model::Guid;
use crate::scene::Scene;
use crate::testing::{prototype_file, simple_file};

fn apply(doc: &mut Document, h: &mut History, json: &str) {
    let ops: Vec<Op> = serde_json::from_str(json).unwrap();
    h.apply(doc, &ops, None).unwrap();
}

fn info(doc: &Document) -> PrototypeInfo {
    let scene = Scene::build(doc, doc.pages[0]);
    prototype(doc, &scene)
}

fn props(doc: &Document, id: &str) -> crate::model::Props {
    doc.props(doc.find(Guid::parse(id).unwrap()).unwrap())
        .clone()
}

#[test]
fn decodes_interactions_flows_overlays_and_legacy_connections() {
    let doc = Document::open(&prototype_file()).unwrap();
    let p = info(&doc);
    assert_eq!(p.flows.len(), 1);
    assert_eq!(p.flows[0].frame, "1:10");
    assert_eq!(p.flows[0].name, "Onboarding");
    assert_eq!(p.flows[0].description, "From the start");
    let names: Vec<_> = p.frames.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["Start", "Details", "Menu", "Done", "Unlinked"]);
    let menu = p.frames.iter().find(|f| f.name == "Menu").unwrap();
    let overlay = menu.overlay.as_ref().unwrap();
    assert_eq!(overlay.position, "CENTER");
    assert!(overlay.close_on_click_outside);
    assert_eq!(overlay.background.as_deref(), Some("00000080"));

    let hotspot = |id: &str| p.hotspots.iter().find(|h| h.id == id).unwrap();
    let next = hotspot("1:11");
    assert_eq!(next.frame, "1:10");
    assert_eq!(next.bounds.x, 100.0);
    let a = &next.interactions[0].actions[0];
    assert_eq!(next.interactions[0].trigger, "ON_CLICK");
    assert_eq!(next.interactions[0].id.as_deref(), Some("1:111"));
    assert_eq!(
        (a.connection.as_str(), a.navigation.as_str()),
        ("INTERNAL_NODE", "NAVIGATE")
    );
    assert_eq!(a.destination.as_deref(), Some("1:20"));
    assert_eq!(a.transition, "DISSOLVE");
    assert_eq!(a.easing.as_deref(), Some("OUT_CUBIC"));
    assert_eq!(
        hotspot("1:12").interactions[0].actions[0].navigation,
        "OVERLAY"
    );
    assert_eq!(
        hotspot("1:21").interactions[0].actions[0].connection,
        "BACK"
    );
    assert_eq!(
        hotspot("1:31").interactions[0].actions[0].connection,
        "CLOSE"
    );
    let site = &hotspot("1:41").interactions[0].actions[0];
    assert_eq!(site.connection, "URL");
    assert_eq!(site.url.as_deref(), Some("https://example.com/"));
    assert_eq!(site.destination, None);
    // The legacy fields read as one click interaction.
    let restart = hotspot("1:42");
    assert_eq!(restart.interactions[0].id, None);
    assert_eq!(restart.interactions[0].trigger, "ON_CLICK");
    assert_eq!(
        restart.interactions[0].actions[0].destination.as_deref(),
        Some("1:10")
    );
    assert_eq!(restart.interactions[0].actions[0].transition, "DISSOLVE");
}

#[test]
fn sets_interactions_keeping_what_the_editor_does_not_show_and_undoes() {
    let mut doc = Document::open(&prototype_file()).unwrap();
    let mut h = History::default();
    // Change the transition of the existing interaction; add a hover one.
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setInteractions","id":"1:11","interactions":[
            {"id":"1:111","actions":[{"transition":"SMART_ANIMATE","duration":0.5}]},
            {"trigger":"ON_HOVER","actions":[{"destination":"1:30","navigation":"OVERLAY"}]}
        ]}]"#,
    );
    let p = props(&doc, "1:11");
    let list = p.interactions.as_deref().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, Some(Guid::parse("1:111").unwrap()));
    let a = &list[0].actions[0];
    assert_eq!(&*a.transition, "SMART_ANIMATE");
    assert_eq!(a.duration, 0.5);
    assert_eq!(a.easing.as_deref(), Some("OUT_CUBIC"), "kept");
    assert_eq!(a.destination, Guid::parse("1:20"), "kept");
    assert_eq!(&*list[1].trigger, "ON_HOVER");
    assert!(list[1].id.is_some(), "a new interaction gets an id");
    assert_eq!(&*list[1].actions[0].navigation, "OVERLAY");
    assert_eq!(&*list[1].actions[0].transition, "INSTANT_TRANSITION");
    let node = doc.find(Guid::parse("1:11").unwrap()).unwrap();
    assert!(doc.node(node).edits & flags::PROTOTYPE != 0);
    h.undo(&mut doc);
    assert_eq!(props(&doc, "1:11").interactions.unwrap().len(), 1);
    assert_eq!(
        &*props(&doc, "1:11").interactions.unwrap()[0].actions[0].transition,
        "DISSOLVE"
    );
}

#[test]
fn rejects_connections_without_a_destination_and_unknown_kinds() {
    let mut doc = Document::open(&prototype_file()).unwrap();
    let mut h = History::default();
    for json in [
        r#"[{"op":"setInteractions","id":"1:11","interactions":[{"actions":[{"connection":"INTERNAL_NODE"}]}]}]"#,
        r#"[{"op":"setInteractions","id":"1:11","interactions":[{"actions":[{"destination":"9:9"}]}]}]"#,
        r#"[{"op":"setInteractions","id":"1:11","interactions":[{"actions":[{"connection":"TELEPORT"}]}]}]"#,
        r#"[{"op":"setInteractions","id":"1:11","interactions":[{"trigger":"on click","actions":[]}]}]"#,
        r#"[{"op":"setFlowStart","id":"1:11","name":"Inner"}]"#,
    ] {
        let ops: Vec<Op> = serde_json::from_str(json).unwrap();
        assert!(h.apply(&mut doc, &ops, None).is_err(), "{json}");
    }
    // Nothing changed.
    assert_eq!(props(&doc, "1:11").interactions.unwrap().len(), 1);
}

#[test]
fn flow_starting_points_are_added_after_the_others_renamed_and_removed() {
    let mut doc = Document::open(&prototype_file()).unwrap();
    let mut h = History::default();
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setFlowStart","id":"1:20","name":"Shortcut"}]"#,
    );
    let p = info(&doc);
    let flows: Vec<_> = p.flows.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(flows, ["Onboarding", "Shortcut"]);
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setFlowStart","id":"1:10","name":"Welcome"}]"#,
    );
    assert_eq!(info(&doc).flows[0].name, "Welcome");
    assert_eq!(info(&doc).flows[0].description, "From the start");
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setFlowStart","id":"1:10","name":null}]"#,
    );
    let p = info(&doc);
    assert_eq!(p.flows.len(), 1);
    assert_eq!(p.flows[0].frame, "1:20");
}

/// The saved file's record of node `local` (session 1), decoded with the
/// file's full schema.
fn saved_record(bytes: &[u8], local: u32) -> (Schema, crate::kiwi::Msg) {
    let container = crate::container::Container::open_without_images(bytes).unwrap();
    let schema = Schema::decode(&container.schema).unwrap();
    let decoder = Decoder::new(&schema);
    let message = decoder
        .decode(
            &mut crate::kiwi::Reader::new(&container.message),
            schema.def_index("Message").unwrap(),
        )
        .unwrap();
    let Some(crate::kiwi::Value::List(nodes)) = message.get(&schema, "nodeChanges") else {
        panic!("no nodes");
    };
    let record = nodes
        .iter()
        .find_map(|n| {
            let crate::kiwi::Value::Msg(m) = n else {
                return None;
            };
            let g = crate::decode::guid(crate::kiwi::MsgRef::new(
                &schema,
                match m.get(&schema, "guid") {
                    Some(crate::kiwi::Value::Msg(g)) => g,
                    _ => return None,
                },
            ))?;
            (g == Guid { session: 1, local }).then(|| (**m).clone())
        })
        .unwrap();
    (schema, record)
}

#[test]
fn saving_writes_interactions_figma_reads_and_keeps_unmodeled_fields() {
    let mut doc = Document::open(&prototype_file()).unwrap();
    let mut h = History::default();
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setInteractions","id":"1:11","interactions":[
              {"id":"1:111","actions":[{"transition":"PUSH_FROM_RIGHT"}]}]},
            {"op":"setInteractions","id":"1:42","interactions":[
              {"actions":[{"destination":"1:20","transition":"DISSOLVE","duration":0.4}]}]},
            {"op":"setFlowStart","id":"1:40","name":"Ending"}]"#,
    );
    let bytes = crate::save::save(&doc, &prototype_file()).unwrap();
    let reopened = Document::open(&bytes).unwrap();
    let p = info(&reopened);
    let next = p.hotspots.iter().find(|h| h.id == "1:11").unwrap();
    assert_eq!(
        next.interactions[0].actions[0].transition,
        "PUSH_FROM_RIGHT"
    );
    assert_eq!(
        next.interactions[0].actions[0].destination.as_deref(),
        Some("1:20")
    );
    let restart = p.hotspots.iter().find(|h| h.id == "1:42").unwrap();
    assert_eq!(restart.interactions.len(), 1);
    assert_eq!(restart.interactions[0].actions[0].duration, 0.4);
    assert!(restart.interactions[0].id.is_some());
    let flows: Vec<_> = p.flows.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(flows, ["Onboarding", "Ending"]);

    // The field names and values are Figma's, and what the engine does
    // not model survives.
    let (schema, record) = saved_record(&bytes, 11);
    let r = crate::kiwi::MsgRef::new(&schema, &record);
    let interaction = r.msgs("prototypeInteractions").next().unwrap();
    let action = interaction.msgs("actions").next().unwrap();
    assert_eq!(action.enum_name("transitionType"), Some("PUSH_FROM_RIGHT"));
    assert_eq!(action.enum_name("connectionType"), Some("INTERNAL_NODE"));
    assert_eq!(action.enum_name("navigationType"), Some("NAVIGATE"));
    assert!(action.msg("extraScrollOffset").is_some(), "kept");
    assert_eq!(
        interaction
            .msg("event")
            .and_then(|e| e.enum_name("interactionType")),
        Some("ON_CLICK")
    );
    // The legacy connection gave way to the interaction.
    let (schema, record) = saved_record(&bytes, 42);
    let r = crate::kiwi::MsgRef::new(&schema, &record);
    assert!(!r.has("transitionNodeID"));
    assert_eq!(r.msgs("prototypeInteractions").count(), 1);
}

#[test]
fn saving_adds_prototype_fields_to_files_without_them() {
    let mut doc = Document::open(&simple_file()).unwrap();
    let mut h = History::default();
    apply(
        &mut doc,
        &mut h,
        r#"[{"op":"setInteractions","id":"1:3","interactions":[
              {"actions":[{"destination":"1:2","transition":"DISSOLVE"}]}]}]"#,
    );
    let bytes = crate::save::save(&doc, &simple_file()).unwrap();
    let reopened = Document::open(&bytes).unwrap();
    let list = props(&reopened, "1:3").interactions.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(&*list[0].actions[0].transition, "DISSOLVE");
    assert_eq!(list[0].actions[0].destination, Guid::parse("1:2"));
    // Everything else reads as before.
    assert_eq!(props(&reopened, "1:3").fills, props(&doc, "1:3").fills,);
}
