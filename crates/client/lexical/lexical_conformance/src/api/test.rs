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
    r.states.insert(0, editor.state().clone());
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
    assert_eq!(r.states[&0].view().text_content(key), "before");
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
    Ok(())
}
