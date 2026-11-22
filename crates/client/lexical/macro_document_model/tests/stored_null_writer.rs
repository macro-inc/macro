//! Slice (B) writer rules, as Source's mirror diff behaves (diff.ts :738-770):
//! 1. creation stores null for an absent own-undefined field (probe 2d5ebf1d);
//! 2. a later write keeps a stored null whose model field is absent, after an
//!    unrelated edit or the node's own re-import (probe 7e0cea51 U/S);
//! 3. a stored VALUE whose model field becomes absent is deleted (probe
//!    8672bafb, existing-node row).
use lexical_loro::{LOCAL_ORIGIN, LoroProjection, new_doc, reconstruct_state};
use lexical_model::*;
use macro_document_model::nodes::{AgentSessionMentionNode, AwaitNode, Maybe};
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::{Value, json};

fn editor(mention: Value) -> Result<Editor> {
    Ok(headless_builder()
        .initial_state(serde_json::from_value(
            json!({"root":{"type":"root","version":1,
            "children":[
                {"type":"paragraph","version":1,"format":"","direction":null,"indent":0,
                    "textFormat":0,"textStyle":"","children":[{"type":"text","version":1,
                    "text":"other","format":0,"detail":0,"mode":"normal","style":""}]},
                {"type":"paragraph","version":1,"format":"","direction":null,"indent":0,
                    "textFormat":0,"textStyle":"","children":[mention]}
            ]}}),
        )?)
        .build()?)
}
fn mention_key(editor: &Editor) -> NodeKey {
    lexical_rich_nodes::utils::dfs(editor.state().view(), None, None)
        .into_iter()
        .find(|entry| {
            editor
                .state()
                .view()
                .is::<AgentSessionMentionNode>(entry.node)
        })
        .expect("mention")
        .node
}
fn other_text(editor: &Editor) -> NodeKey {
    let view = editor.state().view();
    let paragraph = view.first_child_or_err(NodeKey::ROOT).expect("paragraph");
    view.first_child_or_err(paragraph).expect("text")
}
fn stored_mention(doc: &loro::LoroDoc) -> Result<serde_json::Map<String, Value>> {
    let state = reconstruct_state(doc, &MACRO_SYNC_POLICY)?;
    Ok(state.root["children"][1]["children"][0]
        .as_object()
        .cloned()
        .expect("stored mention"))
}

#[test]
fn creation_stores_null_for_absent_mention_fields_with_source_version() -> Result<()> {
    let editor = editor(json!({"type":"agent-session-mention","version":1,"id":"session-1"}))?;
    let doc = new_doc(7)?;
    LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let stored = stored_mention(&doc)?;
    assert_eq!(stored.get("label"), Some(&Value::Null));
    assert_eq!(stored.get("mentionUuid"), Some(&Value::Null));
    // Source stores AgentSessionMentionNode's exportJSON VERSION, 3.
    assert_eq!(stored.get("version"), Some(&json!(3)));
    Ok(())
}

#[test]
fn an_unrelated_edit_keeps_the_stored_nulls() -> Result<()> {
    let mut editor = editor(json!({"type":"agent-session-mention","version":1,"id":"session-1"}))?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let text = other_text(&editor);
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("other edited")?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let stored = stored_mention(&doc)?;
    assert_eq!(stored.get("label"), Some(&Value::Null));
    assert_eq!(stored.get("mentionUuid"), Some(&Value::Null));
    Ok(())
}

#[test]
fn re_importing_the_node_without_the_fields_keeps_the_stored_nulls() -> Result<()> {
    let mut editor = editor(json!({"type":"agent-session-mention","version":1,"id":"session-1"}))?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let key = mention_key(&editor);
    let (_, commit) = editor.update(|tx| {
        let json = json!({"type":"agent-session-mention","version":1,"id":"session-2"});
        tx.update_from_json(key, json.as_object().expect("object"))?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let stored = stored_mention(&doc)?;
    assert_eq!(stored.get("id"), Some(&json!("session-2")));
    assert_eq!(stored.get("label"), Some(&Value::Null));
    assert_eq!(stored.get("mentionUuid"), Some(&Value::Null));
    Ok(())
}

#[test]
fn a_label_made_absent_by_a_local_edit_is_deleted() -> Result<()> {
    let mut editor = editor(
        json!({"type":"agent-session-mention","version":1,"id":"session-1","label":"Label"}),
    )?;
    let doc = new_doc(7)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    assert_eq!(stored_mention(&doc)?.get("label"), Some(&json!("Label")));
    let key = mention_key(&editor);
    let (_, commit) = editor.update(|tx| {
        tx.get_mut::<AgentSessionMentionNode>(key)?.label = Maybe::Missing;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let stored = stored_mention(&doc)?;
    assert!(!stored.contains_key("label"));
    assert_eq!(stored.get("mentionUuid"), Some(&Value::Null));
    Ok(())
}

// C-STORAGE-SLOT-ABSENT-INSERT-01: Source's mirror writes nothing for an own
// field whose cached and new values are both undefined (diff.ts :738-770),
// so a stored map with NO `text` slot (written by a non-Source writer) keeps
// it absent across an Await edit to another own field.
const AWAIT_SLOT_ABSENT: &str = r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","direction":null,"indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi ","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0},{"$":{"id":"kind0001"},"type":"await","awaitId":"await-1","inline":true,"version":1}]}]}"#;

fn await_editor() -> Result<Editor> {
    Ok(headless_builder()
        .initial_state(serde_json::from_str(&format!(
            r#"{{"root":{AWAIT_SLOT_ABSENT}}}"#
        ))?)
        .build()?)
}
fn await_key(editor: &Editor) -> NodeKey {
    lexical_rich_nodes::utils::dfs(editor.state().view(), None, None)
        .into_iter()
        .find(|entry| editor.state().view().is::<AwaitNode>(entry.node))
        .expect("await")
        .node
}
fn stored_await(doc: &loro::LoroDoc) -> Result<serde_json::Map<String, Value>> {
    let state = reconstruct_state(doc, &MACRO_SYNC_POLICY)?;
    Ok(state.root["children"][0]["children"][1]
        .as_object()
        .cloned()
        .expect("stored await"))
}

#[test]
fn an_await_edit_over_an_absent_text_slot_writes_no_text() -> Result<()> {
    let mut editor = await_editor()?;
    let doc = new_doc(7)?;
    lexical_loro::mirror::set_state(&doc, &serde_json::from_str(AWAIT_SLOT_ABSENT)?)?;
    let mut projection = LoroProjection::attach(&doc, editor.state(), &MACRO_SYNC_POLICY)?;
    assert!(!stored_await(&doc)?.contains_key("text"));
    let key = await_key(&editor);
    let (_, commit) = editor.update(|tx| {
        tx.get_mut::<AwaitNode>(key)?.await_id = Maybe::Value("await-2".into());
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(
        stored_await(&doc)?,
        serde_json::from_str::<serde_json::Map<String, Value>>(
            r#"{"$":{"id":"kind0001"},"type":"await","awaitId":"await-2","inline":true,"version":1}"#
        )?
    );
    Ok(())
}

#[test]
fn an_await_text_set_over_an_absent_slot_stores_the_value() -> Result<()> {
    let mut editor = await_editor()?;
    let doc = new_doc(7)?;
    lexical_loro::mirror::set_state(&doc, &serde_json::from_str(AWAIT_SLOT_ABSENT)?)?;
    let mut projection = LoroProjection::attach(&doc, editor.state(), &MACRO_SYNC_POLICY)?;
    let key = await_key(&editor);
    let (_, commit) = editor.update(|tx| {
        tx.get_mut::<AwaitNode>(key)?.text = Maybe::Value("done".into());
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    assert_eq!(stored_await(&doc)?.get("text"), Some(&json!("done")));
    Ok(())
}

// Source stores a plain null here, not an empty LoroText: the all-kinds probe
// log 8672bafb (lines 15-16, diffFromEmpty and diffFromBase) shows the Await
// "text":null from loro.toJSON(), where an empty text container would print "".
#[test]
fn a_created_await_without_text_stores_a_plain_null() -> Result<()> {
    let editor = await_editor()?;
    let doc = new_doc(7)?;
    LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let root = doc.get_map("root");
    let paragraph = root
        .get("children")
        .and_then(|children| children.into_container().ok())
        .and_then(|container| container.into_movable_list().ok())
        .and_then(|list| list.get(0))
        .and_then(|item| item.into_container().ok())
        .and_then(|container| container.into_map().ok())
        .expect("paragraph map");
    let node = paragraph
        .get("children")
        .and_then(|children| children.into_container().ok())
        .and_then(|container| container.into_movable_list().ok())
        .and_then(|list| list.get(1))
        .and_then(|item| item.into_container().ok())
        .and_then(|container| container.into_map().ok())
        .expect("await map");
    assert!(matches!(
        node.get("text"),
        Some(loro::ValueOrContainer::Value(loro::LoroValue::Null))
    ));
    Ok(())
}

// The same rule for a builtin storage-null key: a paragraph whose stored map
// has NO `direction` slot keeps it absent across an own-field edit.
const PARAGRAPH_SLOT_ABSENT: &str = r#"{"type":"root","version":1,"format":"","children":[{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","indent":0,"type":"paragraph","version":1,"format":"","children":[{"$":{"id":"text0001"},"text":"hi","style":"","type":"text","version":1,"format":0,"mode":"normal","detail":0}]}]}"#;

#[test]
fn a_paragraph_edit_over_an_absent_direction_slot_writes_no_direction() -> Result<()> {
    let mut editor = headless_builder()
        .initial_state(serde_json::from_str(&format!(
            r#"{{"root":{PARAGRAPH_SLOT_ABSENT}}}"#
        ))?)
        .build()?;
    let doc = new_doc(7)?;
    lexical_loro::mirror::set_state(&doc, &serde_json::from_str(PARAGRAPH_SLOT_ABSENT)?)?;
    let mut projection = LoroProjection::attach(&doc, editor.state(), &MACRO_SYNC_POLICY)?;
    let paragraph = editor
        .state()
        .view()
        .first_child_or_err(NodeKey::ROOT)
        .expect("paragraph");
    let (_, commit) = editor.update(|tx| {
        tx.set_indent(paragraph, 1)?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let state = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
    let mut stored = state.root["children"][0]
        .as_object()
        .cloned()
        .expect("stored paragraph");
    stored.remove("children");
    assert_eq!(
        stored,
        serde_json::from_str::<serde_json::Map<String, Value>>(
            r#"{"$":{"id":"para0001"},"textFormat":0,"textStyle":"","indent":1,"type":"paragraph","version":1,"format":""}"#
        )?
    );
    Ok(())
}
