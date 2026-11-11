//! Convert-to-text literals observed from Source $convertPasteToText (usePasteNode)
//! over the app markdown-sync Source editor (createLexicalWrapper), same inputs.
use crate::{EditorType, nodes::PasteNode, plugins_group_b::decode_command, surface};
use lexical_model::*;
use serde_json::Value;

const ORACLE: &str = include_str!("source-oracle.json");

fn run(case: &str, command: &str) -> Result<(Editor, Handled, Value, Value), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let case = oracle.get(case).expect("oracle case").clone();
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state = editor.parse_editor_state_str(&case["input"].to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let paste = editor
        .state()
        .view()
        .children_keys(NodeKey::ROOT)?
        .into_iter()
        .find(|key| editor.state().view().is::<PasteNode>(*key))
        .expect("paste");
    let command = decode_command(
        command,
        &serde_json::json!({ "key": paste.index() }).to_string(),
        paste.generation(),
        None,
    )?
    .expect("paste command");
    let before = serde_json::to_value(editor.state().to_json()?)?;
    let (handled, commit) = editor.dispatch(&command)?;
    // Source adds no update tags in any case (its listener saw none).
    let source_tags: Vec<String> = case["tags"]
        .as_array()
        .expect("tags")
        .iter()
        .flat_map(|tags| tags.as_array().expect("tag list").clone())
        .map(|tag| tag.as_str().expect("tag").to_owned())
        .collect();
    let native_tags: Vec<String> = commit.tags.iter().map(ToString::to_string).collect();
    assert_eq!(native_tags, source_tags);
    Ok((editor, handled, before, case))
}

fn collapsed_text_caret(editor: &Editor) -> Option<(u32, String)> {
    let range = editor.state().selection().and_then(Selection::as_range)?;
    assert!(range.is_collapsed());
    let view = editor.state().view();
    Some((
        range.anchor.offset(),
        view.text_content(range.anchor.key()).into_owned(),
    ))
}

fn assert_output(editor: &Editor, before: &Value, case: &Value) -> Result<(), Error> {
    let actual = serde_json::to_value(editor.state().to_json()?)?;
    // The action's tree must equal Source exactly; root state belongs to the
    // preset's metadata plugin and must be left untouched by the action.
    assert_eq!(
        actual["root"]["children"],
        case["output"]["root"]["children"]
    );
    assert_eq!(actual["root"]["$"], before["root"]["$"]);
    let expected = case["selection"].as_object().map(|selection| {
        let anchor = selection["anchor"].as_array().expect("anchor");
        (
            u32::try_from(anchor[0].as_u64().expect("offset")).expect("u32"),
            anchor[3].as_str().expect("text").to_owned(),
        )
    });
    assert_eq!(collapsed_text_caret(editor), expected);
    Ok(())
}

#[test]
fn to_text_imports_markdown_content_and_selects_the_last_end() -> Result<(), Error> {
    let (editor, handled, before, case) = run("paste-markdown", "group-b.paste-to-text")?;
    assert_eq!(handled, Handled::Yes);
    assert_output(&editor, &before, &case)
}

#[test]
fn to_text_converts_a_referenced_paste_at_the_document_start() -> Result<(), Error> {
    let (editor, handled, before, case) = run("paste-plain-referenced", "group-b.paste-to-text")?;
    assert_eq!(handled, Handled::Yes);
    assert_output(&editor, &before, &case)
}

#[test]
fn to_text_yields_for_non_paste_targets() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state = editor.parse_editor_state_str(&oracle["paste-markdown"]["input"].to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let command = decode_command(
        "group-b.paste-to-text",
        &serde_json::json!({ "key": paragraph.index() }).to_string(),
        paragraph.generation(),
        None,
    )?
    .expect("paste command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    Ok(())
}
