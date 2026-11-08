use crate::{api, replay::Replayer};
use lexical_model::*;
use serde_json::json;

#[test]
fn indexed_calls_mutate_the_same_model_and_keep_captured_records()
-> Result<(), crate::replay::ReplayError> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut r = Replayer::default();
    let mut tx = editor.transaction();
    let text_id = api::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text API") as u32;
    let set_id = api::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("setter API") as u32;
    let get_id = api::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("getter API") as u32;
    let field_id = api::index()
        .binary_search(&"get:__text")
        .expect("field API") as u32;
    let node = api::call_by_id(&mut r, &mut tx, text_id, json!(["before"]), None)?;
    let key = crate::replay::node_key(&node)?;
    let paragraph = tx.create(Paragraph::default())?.key();
    tx.append(paragraph, &[key])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.commit()?;
    r.bindings.pin_state(0, editor.state().clone())?;
    r.version = 1;
    let mut tx = editor.transaction();
    let writable_id = api::index()
        .binary_search(&"LexicalNode.getWritable")
        .expect("writable API") as u32;
    let writable = api::call_by_id(&mut r, &mut tx, writable_id, json!([]), Some(node.clone()))?;
    assert_ne!(writable["identity"], node["identity"]);
    assert!(tx.is_writable(key));
    assert_eq!(
        api::call_by_id(&mut r, &mut tx, writable_id, json!([]), Some(node.clone()))?,
        writable
    );
    api::call_by_id(
        &mut r,
        &mut tx,
        set_id,
        json!(["after"]),
        Some(node.clone()),
    )?;
    assert_eq!(
        api::call_by_id(&mut r, &mut tx, get_id, json!([]), Some(node.clone()))?,
        "after"
    );
    assert_eq!(
        api::call_by_id(&mut r, &mut tx, field_id, json!([]), Some(node))?,
        "before"
    );
    assert!(api::call_by_id(&mut r, &mut tx, u32::MAX, json!([]), None).is_err());
    assert_eq!(
        r.bindings
            .state(&0)?
            .expect("state")
            .view()
            .text_content(key),
        "before"
    );
    Ok(())
}

#[test]
fn api_node_handles_remain_usable_after_the_shared_counter_resets()
-> Result<(), crate::replay::ReplayError> {
    let keys = SharedKeyCounter::new();
    keys.reset()?;
    let mut editor = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .build()
        .expect("editor");
    let mut replayer = Replayer {
        in_callback: true,
        ..Replayer::default()
    };
    let mut tx = editor.transaction();
    let text = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"lexical.$createTextNode","args":["hi"]}),
    )?;
    let content = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"LexicalNode.getTextContent","this":text,"args":[]}),
    )?;
    assert_eq!(content, "hi");
    let key = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"LexicalNode.getKey","this":text,"args":[]}),
    )?;
    let selected = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"lexical.$getNodeByKey","args":[key]}),
    )?;
    assert_eq!(selected, text);
    let paragraph = tx.create(Paragraph::default())?.key();
    tx.append(paragraph, &[crate::replay::node_key(&text)?])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    let parents = api::call(
        &mut replayer,
        &mut tx,
        &json!({
            "fn":"LexicalNode.getParentKeys", "this":text, "args":[]
        }),
    )?;
    assert_eq!(parents[0], crate::replay::key_value(paragraph));
    let parent = api::call(
        &mut replayer,
        &mut tx,
        &json!({
            "fn":"lexical.$getNodeByKey", "args":[parents[0]]
        }),
    )?;
    assert_eq!(crate::replay::node_key(&parent)?, paragraph);
    Ok(())
}

#[test]
fn raw_framework_fields_expose_links_and_distinguish_element_and_text_properties()
-> Result<(), crate::replay::ReplayError> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut r = Replayer::default();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?.key();
    tx.update_from_json(p, json!({"format":"right","indent":2,"direction":"rtl","textFormat":2,"textStyle":"font-weight: bold;","style":"margin: 0;"}).as_object().expect("object"))?;
    tx.element(p)?.set_style("margin: 0;")?;
    let a = tx.import_node(json!({"type":"text","version":1,"text":"a","format":1,"detail":2,"mode":"token","style":"color: red;","$":{"role":"one"}}).as_object().expect("object"))?;
    let b = tx.import_node(json!({"type":"text","version":1,"text":"b","format":0,"detail":0,"mode":"normal","style":"","$":{"role":"two"}}).as_object().expect("object"))?;
    tx.append(p, &[a, b])?;
    tx.append(NodeKey::ROOT, &[p])?;
    let p_node = r.node(tx.view(), p)?;
    let a_node = r.node(tx.view(), a)?;
    let b_node = r.node(tx.view(), b)?;
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__first")?,
        crate::replay::key_value(a)
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__last")?,
        crate::replay::key_value(b)
    );
    assert_eq!(api::properties::get(&mut r, &mut tx, &p_node, "__size")?, 2);
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__indent")?,
        2
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__dir")?,
        "rtl"
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__format")?,
        3
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__style")?,
        "margin: 0;"
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__textFormat")?,
        2
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__textStyle")?,
        "font-weight: bold;"
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__parent")?,
        crate::replay::key_value(p)
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__prev")?,
        serde_json::Value::Null
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__next")?,
        crate::replay::key_value(b)
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &b_node, "__prev")?,
        crate::replay::key_value(a)
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__format")?,
        1
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__detail")?,
        2
    );
    assert_eq!(api::properties::get(&mut r, &mut tx, &a_node, "__mode")?, 1);
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &a_node, "__style")?,
        "color: red;"
    );
    assert_eq!(
        api::properties::get(&mut r, &mut tx, &p_node, "__state")?,
        json!({"$undef":true})
    );
    let a_state = api::properties::get(&mut r, &mut tx, &a_node, "__state")?;
    let b_state = api::properties::get(&mut r, &mut tx, &b_node, "__state")?;
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"lexical.nodeStatesAreEquivalent","args":[a_state,a_state]})
        )?,
        true
    );
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"lexical.nodeStatesAreEquivalent","args":[a_state,b_state]})
        )?,
        false
    );
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"lexical.nodeStatesAreEquivalent","args":[{"$undef":true},null]})
        )?,
        true
    );
    Ok(())
}

#[test]
fn foreign_link_ancestry_does_not_route_core_methods_through_a_native_payload_cast()
-> Result<(), crate::replay::ReplayError> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<lexical_rich_nodes::link::LinkNode>()
        .foreign_node(ForeignNodeType {
            type_name: "custom-link".into(),
            class_name: "CustomLink".into(),
            kind: NodeKind::Element,
            extends: Some("link"),
            required_state: vec![],
            hooks: std::sync::Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut r = Replayer::default();
    let mut tx = editor.transaction();
    let link = tx.create_foreign(
        "custom-link",
        json!({"url":"https://example.test"})
            .as_object()
            .expect("object")
            .clone(),
    )?;
    let text = tx.create_text("hello")?.key();
    tx.append(link, &[text])?;
    let node = r.node(tx.view(), link)?;
    assert!(tx.is::<lexical_rich_nodes::link::LinkNode>(link));
    assert!(tx.get::<lexical_rich_nodes::link::LinkNode>(link).is_none());
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"LexicalNode.getType","this":node,"args":[]})
        )?,
        "custom-link"
    );
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"LexicalNode.getTextContent","this":node,"args":[]})
        )?,
        "hello"
    );
    assert_eq!(
        api::call(
            &mut r,
            &mut tx,
            &json!({"fn":"LexicalNode.isInline","this":node,"args":[]})
        )?,
        true
    );
    Ok(())
}

#[test]
fn nested_model_callback_frames_share_record_identity_without_borrowing_the_parent_dispatcher()
-> Result<(), crate::replay::ReplayError> {
    struct Hooks {
        records: crate::replay::RecordIdentities,
        bindings: crate::replay::Bindings,
        seen: std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    }
    impl ForeignHooks for Hooks {
        fn insert_after(
            &self,
            tx: &mut Transaction<'_>,
            _: NodeKey,
            sibling: NodeKey,
            _: bool,
        ) -> Override<std::result::Result<NodeKey, Error>> {
            let result = (|| -> Result<(), crate::replay::ReplayError> {
                let mut child = Replayer {
                    record_ids: self.records.clone(),
                    bindings: self.bindings.clone(),
                    record_owner: Some((0, tx.committed_state().clone())),
                    version: 1,
                    in_callback: true,
                    ..Replayer::default()
                };
                let sibling_handle = child.decode(&json!({"$h":22}))?;
                assert_eq!(crate::replay::node_key(&sibling_handle)?, sibling);
                assert_eq!(
                    api::call(
                        &mut child,
                        tx,
                        &json!({"fn":"LexicalNode.getType","this":{"$h":22},"args":[]}),
                    )?,
                    "paragraph"
                );
                assert_eq!(
                    super::lexical::key_arg(&child, &json!(sibling.to_string()))?,
                    sibling
                );
                let nested = api::call(
                    &mut child,
                    tx,
                    &json!({"fn":"lexical.$createTextNode","args":["nested"]}),
                )?;
                tx.append(sibling, &[crate::replay::node_key(&nested)?])?;
                child.compare(&json!({"$h":77,"key":nested["$node"].as_u64().expect("key").to_string(),"type":"text","ver":1}), &nested)?;
                let committed = tx.committed_state().clone();
                let root = child.node(committed.view(), NodeKey::ROOT)?;
                assert_eq!(root["ver"], 0);
                assert_eq!(super::properties::get(&mut child, tx, &root, "__size")?, 0);
                let snapshot = api::call(
                    &mut child,
                    tx,
                    &json!({"fn":"LexicalEditor.getEditorState","args":[]}),
                )?;
                self.seen
                    .lock()
                    .expect("test log")
                    .extend([nested, root, snapshot]);
                Ok(())
            })();
            match result {
                Ok(()) => Override::Inherit,
                Err(error) => Override::Value(Err(Error::invariant(error.to_string()))),
            }
        }
    }
    let records = crate::replay::RecordIdentities::default();
    let bindings = crate::replay::Bindings::default();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "callback-paragraph".into(),
            class_name: "CallbackParagraph".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: std::sync::Arc::new(Hooks {
                records: records.clone(),
                bindings: bindings.clone(),
                seen: seen.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut parent = Replayer {
        record_ids: records.clone(),
        bindings: bindings.clone(),
        record_owner: Some((0, editor.state().clone())),
        version: 1,
        ..Replayer::default()
    };
    bindings.pin_state(0, editor.state().clone())?;
    let mut tx = editor.transaction();
    let first = tx.create_foreign("callback-paragraph", SerializedNode::new())?;
    let sibling = tx.create(Paragraph::default())?.key();
    tx.append(NodeKey::ROOT, &[first])?;
    let first = parent.node(tx.view(), first)?;
    let sibling = parent.node(tx.view(), sibling)?;
    parent.compare(&json!({"$h":22,"key":sibling["$node"].as_u64().expect("key").to_string(),"type":"paragraph","ver":1}), &sibling)?;
    let returned = api::call(
        &mut parent,
        &mut tx,
        &json!({"fn":"LexicalNode.insertAfter","this":first,"args":[sibling]}),
    )?;
    let nested = seen.lock().expect("test log")[0].clone();
    assert_eq!(parent.decode(&json!({"$h":77}))?, nested);
    assert_eq!(
        super::lexical::key_arg(
            &parent,
            &json!(nested["$node"].as_u64().expect("key").to_string())
        )?,
        crate::replay::node_key(&nested)?
    );
    let root = seen.lock().expect("test log")[1].clone();
    assert_eq!(
        parent.node(tx.committed_state().view(), NodeKey::ROOT)?,
        root
    );
    let snapshot = seen.lock().expect("test log")[2].clone();
    assert_eq!(
        parent
            .saved_state(snapshot["$snapshot"].as_u64().expect("snapshot") as usize)?
            .view()
            .text_content(NodeKey::ROOT),
        ""
    );
    assert_ne!(nested["identity"], first["identity"]);
    assert_ne!(nested["identity"], sibling["identity"]);
    assert_eq!(returned["identity"], sibling["identity"]);
    assert_eq!(
        parent.node(tx.view(), crate::replay::node_key(&nested)?)?,
        nested
    );
    assert_eq!(tx.text_content(NodeKey::ROOT), "\n\nnested");
    tx.commit()?;
    records.release_version(1)?;
    let recaptured = parent.node(editor.state().view(), crate::replay::node_key(&nested)?)?;
    assert_ne!(recaptured["identity"], nested["identity"]);
    bindings.release_saved_state(snapshot["$snapshot"].as_u64().expect("snapshot") as usize)?;
    bindings.release_state(0)?;
    Ok(())
}
