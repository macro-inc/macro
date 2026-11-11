use super::*;
use crate::{EditorType, surface};

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .build()
        .expect("surface")
}

fn stored(editor: &Editor) -> Result<Value, Error> {
    Ok(query("group-b.pinned-properties", &json!({}), editor.state())?.expect("reply"))
}

fn update(editor: &mut Editor, operations: Value) -> Result<Commit, Error> {
    let command = surface::decode_command(
        "group-b.pinned-properties",
        &json!({ "operations": operations }).to_string(),
        0,
        None,
    )?
    .expect("action");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    Ok(commit)
}

fn root_state(editor: &Editor) -> Result<Value, Error> {
    let json = serde_json::to_value(editor.state().to_json()?)?;
    Ok(json["root"]["$"].clone())
}

#[test]
fn an_untouched_root_has_no_stored_pins() -> Result<(), Error> {
    let editor = editor();
    assert_eq!(stored(&editor)?, json!({ "ids": null }));
    assert_eq!(root_state(&editor)?.get("pinnedPropertyIds"), None);
    Ok(())
}

#[test]
fn pins_append_in_order_and_persist_on_the_root() -> Result<(), Error> {
    let mut editor = editor();
    update(
        &mut editor,
        json!([{ "id": "a", "pin": true }, { "id": "b", "pin": true }]),
    )?;
    assert_eq!(stored(&editor)?, json!({ "ids": ["a", "b"] }));
    assert_eq!(root_state(&editor)?["pinnedPropertyIds"], json!(["a", "b"]));
    Ok(())
}

#[test]
fn pinning_a_present_id_leaves_the_list_unchanged() -> Result<(), Error> {
    let mut editor = editor();
    update(&mut editor, json!([{ "id": "a", "pin": true }]))?;
    let before = editor.state().to_json()?;
    let commit = update(&mut editor, json!([{ "id": "a", "pin": true }]))?;
    assert!(commit.is_noop());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn removing_from_an_untouched_root_stores_an_empty_list() -> Result<(), Error> {
    let mut editor = editor();
    update(&mut editor, json!([{ "id": "a", "pin": false }]))?;
    assert_eq!(stored(&editor)?, json!({ "ids": [] }));
    assert_eq!(root_state(&editor)?["pinnedPropertyIds"], json!([]));
    Ok(())
}

#[test]
fn operations_apply_in_order_within_one_update() -> Result<(), Error> {
    let mut editor = editor();
    update(
        &mut editor,
        json!([
            { "id": "a", "pin": true },
            { "id": "b", "pin": true },
            { "id": "a", "pin": false },
            { "id": "pending:definition", "pin": false }
        ]),
    )?;
    assert_eq!(stored(&editor)?, json!({ "ids": ["b"] }));
    Ok(())
}

#[test]
fn imported_pins_keep_only_string_entries() -> Result<(), Error> {
    let mut editor = editor();
    editor.update(|tx| {
        let mut data = serde_json::Map::new();
        data.insert(
            "$".into(),
            json!({ "pinnedPropertyIds": ["x", 3, null, "y"] }),
        );
        tx.update_from_json(NodeKey::ROOT, &data)
    })?;
    assert_eq!(stored(&editor)?, json!({ "ids": ["x", "y"] }));
    Ok(())
}

/// Source parse returns a fresh array for any present value, so a stored null,
/// non-array or empty list reads as an explicitly stored empty list.
#[test]
fn imported_null_invalid_and_empty_pins_are_stored_empty_lists() -> Result<(), Error> {
    for raw in [Value::Null, json!("x"), json!({ "a": 1 }), json!([])] {
        let mut editor = editor();
        editor.update(|tx| {
            let mut data = serde_json::Map::new();
            data.insert("$".into(), json!({ "pinnedPropertyIds": raw.clone() }));
            tx.update_from_json(NodeKey::ROOT, &data)
        })?;
        assert_eq!(stored(&editor)?, json!({ "ids": [] }), "{raw}");
    }
    Ok(())
}

#[test]
fn pinned_properties_reject_positional_operations() {
    assert!(
        decode(
            "group-b.pinned-properties",
            r#"{"operations":[["a",true]]}"#
        )
        .is_err()
    );
    assert!(
        decode(
            "group-b.pinned-properties",
            r#"{"operations":{"id":"a","pin":true}}"#
        )
        .is_err()
    );
}

#[test]
fn pinned_properties_reject_unexpected_payloads() {
    assert!(decode("group-b.pinned-properties", "{}").is_err());
    assert!(decode("group-b.pinned-properties", "[]").is_err());
    assert!(
        decode(
            "group-b.pinned-properties",
            r#"{"operations":[{"id":1,"pin":true}]}"#
        )
        .is_err()
    );
    assert!(
        decode(
            "group-b.pinned-properties",
            r#"{"operations":[],"extra":1}"#
        )
        .is_err()
    );
    assert!(decode("other.action", "{}").expect("unknown").is_none());
    assert!(query("group-b.pinned-properties", &json!([]), editor().state()).is_err());
}
