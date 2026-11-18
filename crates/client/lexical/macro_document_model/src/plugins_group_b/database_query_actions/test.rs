//! Save/discard literals observed from the Source DatabaseQuery component
//! update bodies (app markdown-sync editor), same inputs.
use crate::{EditorType, nodes::DatabaseQueryNode, plugins_group_b::decode_command, surface};
use lexical_model::*;
use serde_json::Value;

const ORACLE: &str = include_str!("source-oracle.json");

fn find_query(view: StateRef<'_>, key: NodeKey) -> Option<NodeKey> {
    if view.is::<DatabaseQueryNode>(key) {
        return Some(key);
    }
    view.children_keys(key)
        .ok()?
        .into_iter()
        .find_map(|child| find_query(view, child))
}

fn run(name: &str) -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let case = &oracle[name];
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let state = editor.parse_editor_state_str(&case["input"].to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    let query = find_query(editor.state().view(), NodeKey::ROOT).expect("query");
    let (command, payload) = if case["action"] == "discard" {
        (
            "group-b.database-query-discard",
            serde_json::json!({ "key": query.index() }),
        )
    } else {
        (
            "group-b.database-query-save",
            serde_json::json!({ "key": query.index(), "data": case["data"] }),
        )
    };
    let command = decode_command(command, &payload.to_string(), query.generation(), None)?
        .expect("database query command");
    let before = serde_json::to_value(editor.state().to_json()?)?;
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let actual = serde_json::to_value(editor.state().to_json()?)?;
    assert_eq!(
        actual["root"]["children"],
        case["output"]["root"]["children"]
    );
    assert_eq!(actual["root"]["$"], before["root"]["$"]);
    let tags: Vec<String> = commit.tags.iter().map(ToString::to_string).collect();
    assert_eq!(Value::from(vec![Value::from(tags)]), case["tags"]);
    let selection = editor.state().selection().and_then(Selection::as_range);
    match case["selection"].as_object() {
        None => assert!(selection.is_none()),
        Some(expected) => {
            let range = selection.expect("range");
            assert!(range.is_collapsed());
            let anchor = expected["anchor"].as_array().expect("anchor");
            let view = editor.state().view();
            assert_eq!(
                u64::from(range.anchor.offset()),
                anchor[0].as_u64().expect("offset")
            );
            assert_eq!(
                view.text_content(range.anchor.key()),
                anchor[3].as_str().expect("text")
            );
        }
    }
    Ok(())
}

#[test]
fn save_inline_only_child_to_block_replaces_the_paragraph() -> Result<(), Error> {
    run("save-inline-only-child-to-table")
}

#[test]
fn save_inline_with_siblings_to_block_inserts_after_the_top_level() -> Result<(), Error> {
    run("save-inline-with-siblings-to-table")
}

#[test]
fn save_block_to_scalar_wraps_it_in_a_paragraph() -> Result<(), Error> {
    run("save-block-to-scalar")
}

#[test]
fn save_same_inline_mode_updates_in_place() -> Result<(), Error> {
    run("save-same-mode")
}

#[test]
fn discard_selects_previous_and_removes() -> Result<(), Error> {
    run("discard-block")
}
