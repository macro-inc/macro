//! Tag-info literals observed from Source TagMentionNode.setTagInfo inside the
//! TagMention update (app markdown-sync editor, Source tags), same inputs.
use crate::{EditorType, plugins_group_b::decode_command, surface};
use lexical_model::*;
use serde_json::Value;

const ORACLE: &str = include_str!("source-oracle.json");

fn run(case: &str) -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let case = &oracle[case];
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state = editor.parse_editor_state_str(&case["input"].to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let view = editor.state().view();
    let paragraph = view.children_keys(NodeKey::ROOT)?[0];
    let tag = view.children_keys(paragraph)?[0];
    let mut payload = case["info"].clone();
    payload["key"] = Value::from(tag.index());
    let command = decode_command(
        "group-b.tag-info",
        &payload.to_string(),
        tag.generation(),
        None,
    )?
    .expect("tag info command");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let actual = serde_json::to_value(editor.state().to_json()?)?;
    assert_eq!(
        actual["root"]["children"],
        case["output"]["root"]["children"]
    );
    let mut tags: Vec<String> = commit.tags.iter().map(ToString::to_string).collect();
    tags.sort();
    assert_eq!(Value::from(vec![Value::from(tags)]), case["tags"]);
    Ok(())
}

#[test]
fn tag_info_replaces_resolved_fields_with_source_tags() -> Result<(), Error> {
    run("tag-info-with-color")
}

#[test]
fn tag_info_without_a_color_omits_it_like_source() -> Result<(), Error> {
    run("tag-info-without-color")
}

#[test]
fn tag_info_yields_for_non_tag_targets() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state =
        editor.parse_editor_state_str(&oracle["tag-info-with-color"]["input"].to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let paragraph = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    let mut payload = oracle["tag-info-with-color"]["info"].clone();
    payload["key"] = Value::from(paragraph.index());
    let command = decode_command(
        "group-b.tag-info",
        &payload.to_string(),
        paragraph.generation(),
        None,
    )?
    .expect("tag info command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    Ok(())
}
