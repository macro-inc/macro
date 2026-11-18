//! Literal Source AgentSessionMention expand/collapse and first-mount normalize.
use crate::{EditorType, plugins_group_b::decode_command, surface};
use lexical_model::*;
use serde_json::{Value, json};

fn editor(input: Value) -> Result<Editor, Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state = editor.parse_editor_state_str(&input.to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    Ok(editor)
}

fn text(text: &str) -> Value {
    json!({"type":"text","version":1,"text":text,"format":0,"detail":0,"mode":"normal","style":""})
}

fn paragraph(children: Vec<Value>) -> Value {
    json!({"type":"paragraph","version":1,"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","children":children})
}

fn root(children: Vec<Value>) -> Value {
    json!({"root":{"type":"root","version":1,"direction":null,"format":"","indent":0,"children":children}})
}

fn mention(expanded: bool) -> Value {
    json!({"type":"agent-session-mention","version":3,"id":"s1","label":"Session","expanded":expanded})
}

fn dispatch(
    editor: &mut Editor,
    name: &str,
    payload: Value,
    key: NodeKey,
) -> Result<Handled, Error> {
    let command = decode_command(name, &payload.to_string(), key.generation(), None)?
        .expect("registered agent session command");
    Ok(editor.dispatch(&command)?.0)
}

fn children_types(editor: &Editor) -> Result<Value, Error> {
    let actual = serde_json::to_value(editor.state().to_json()?)?;
    Ok(Value::from(
        actual["root"]["children"]
            .as_array()
            .expect("root children")
            .iter()
            .map(|block| {
                let inner: Vec<Value> = block["children"]
                    .as_array()
                    .map(|c| c.iter().map(|n| n["type"].clone()).collect())
                    .unwrap_or_default();
                json!({"type": block["type"], "children": inner})
            })
            .collect::<Vec<_>>(),
    ))
}

#[test]
fn expanding_a_chip_lifts_it_to_the_root_between_split_paragraphs() -> Result<(), Error> {
    let mut editor = editor(root(vec![paragraph(vec![
        text("Before "),
        mention(false),
        text(" after"),
    ])]))?;
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let chip = editor.state().view().children_keys(paragraph)?[1];
    assert_eq!(
        dispatch(
            &mut editor,
            "group-b.agent-session-expanded",
            json!({"key": chip.index(), "expanded": true}),
            chip
        )?,
        Handled::Yes
    );
    assert_eq!(
        children_types(&editor)?,
        json!([
            {"type":"paragraph","children":["text"]},
            {"type":"agent-session-mention","children":[]},
            {"type":"paragraph","children":["text"]}
        ])
    );
    Ok(())
}

#[test]
fn collapsing_a_root_card_wraps_it_in_a_paragraph() -> Result<(), Error> {
    let mut editor = editor(root(vec![mention(true)]))?;
    let card = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    dispatch(
        &mut editor,
        "group-b.agent-session-expanded",
        json!({"key": card.index(), "expanded": false}),
        card,
    )?;
    // Source 5cf code trace (card-collapse-trace.md, SHA-256 c3e102b5...): the collapse
    // update wraps the card in a paragraph; trailingParagraphPlugin.ts:103-107 appends only
    // after a block decorator, code block or table, so no trailing paragraph follows.
    assert_eq!(
        children_types(&editor)?,
        json!([
            {"type":"paragraph","children":["agent-session-mention"]}
        ])
    );
    Ok(())
}

#[test]
fn normalize_lifts_a_stored_expanded_card_out_of_its_paragraph() -> Result<(), Error> {
    let mut editor = editor(root(vec![paragraph(vec![mention(true)])]))?;
    assert_eq!(
        children_types(&editor)?,
        json!([{"type":"paragraph","children":["agent-session-mention"]}])
    );
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let card = editor.state().view().children_keys(paragraph)?[0];
    dispatch(
        &mut editor,
        "group-b.agent-session-normalize",
        json!({"key": card.index()}),
        card,
    )?;
    assert_eq!(
        children_types(&editor)?,
        json!([
            {"type":"agent-session-mention","children":[]},
            {"type":"paragraph","children":[]}
        ])
    );
    Ok(())
}

#[test]
fn agent_session_actions_yield_for_other_targets() -> Result<(), Error> {
    let mut editor = editor(root(vec![paragraph(vec![text("plain")])]))?;
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    for (name, payload) in [
        (
            "group-b.agent-session-expanded",
            json!({"key": paragraph.index(), "expanded": true}),
        ),
        (
            "group-b.agent-session-normalize",
            json!({"key": paragraph.index()}),
        ),
    ] {
        assert_eq!(
            dispatch(&mut editor, name, payload, paragraph)?,
            Handled::No
        );
    }
    Ok(())
}

#[test]
fn agent_session_actions_reject_positional_payloads() {
    for (name, json) in [
        ("group-b.agent-session-expanded", "[1, true]"),
        ("group-b.agent-session-normalize", "[1]"),
    ] {
        let error = decode_command(name, json, 0, None);
        assert!(
            matches!(error, Err(Error::Invariant(_))),
            "{name}: {error:?}"
        );
    }
}
