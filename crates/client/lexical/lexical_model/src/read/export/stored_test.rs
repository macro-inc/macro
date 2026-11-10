use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

static VALUE: StateKey<u32> = StateKey::new("stored-value", |value| {
    value
        .map(|value| value.get("n").unwrap_or(value))
        .and_then(Value::as_u64)
        .and_then(|value| value.try_into().ok())
        .unwrap_or(0)
});
static OTHER: StateKey<bool> = StateKey::new("other", |value| value.is_some_and(js_truthy));
static RESET: StateKey<u32> = StateKey::new("reset", |value| {
    value
        .and_then(|value| value.get("n"))
        .and_then(Value::as_u64)
        .and_then(|value| value.try_into().ok())
        .unwrap_or(0)
})
.reset_on_copy();

fn imported() -> Result<Editor, Box<dyn std::error::Error>> {
    Ok(Editor::builder(EditorMode::Headless)
        .initial_state(serde_json::from_value(json!({"root": {
            "type":"root", "version":1,
            "$":{"stored-value":{"n":4}, "unknown":"retained"},
            "children":[{"type":"paragraph","version":1,"children":[]}]
        }}))?)
        .build()?)
}

#[test]
fn lazy_read_and_cow_preserve_storage_until_the_key_is_explicitly_written()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = imported()?;
    let before = editor.state().clone();
    assert_eq!(before.view().get_state(NodeKey::ROOT, &VALUE)?, 4);
    assert!(before.same_snapshot(editor.state()));
    assert_eq!(
        before.view().export_json(NodeKey::ROOT)?["$"]["stored-value"],
        4
    );
    assert_eq!(
        before.view().export_stored_json(NodeKey::ROOT)?["$"],
        json!({"stored-value":{"n":4},"unknown":"retained"})
    );
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &OTHER, true))?;
    assert_eq!(
        editor.state().view().export_stored_json(NodeKey::ROOT)?["$"],
        json!({"stored-value":{"n":4},"unknown":"retained","other":true})
    );
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &VALUE, 5))?;
    assert_eq!(
        editor.state().view().export_stored_json(NodeKey::ROOT)?["$"]["stored-value"],
        5
    );
    assert_eq!(
        before.view().export_stored_json(NodeKey::ROOT)?["$"]["stored-value"],
        json!({"n":4})
    );
    editor.update(|tx| tx.set_state(NodeKey::ROOT, &VALUE, 0))?;
    assert!(
        editor.state().view().export_stored_json(NodeKey::ROOT)?["$"]
            .get("stored-value")
            .is_none()
    );
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Eager {}
impl NodeType for Eager {
    const TYPE: &'static str = "stored-eager";
    type Kind = DecoratorKind;
    const REQUIRED_STATE: &'static [RequiredState] = &[RequiredState::flat(&VALUE)];
    impl_default_node!();
}
impl DecoratorNode for Eager {
    decorator_node_base!();
}

#[test]
fn eager_flat_and_learned_imports_retain_raw_defaults_and_missing_presence()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Eager>()
        .build()?;
    let (key, _) = editor.update(|tx| {
        let node = tx.import_node(
            json!({"type":"stored-eager","stored-value":{"n":0}})
                .as_object()
                .expect("literal node"),
        )?;
        tx.append(NodeKey::ROOT, &[node])?;
        Ok(node)
    })?;
    assert_eq!(editor.state().view().get_state(key, &VALUE)?, 0);
    assert!(
        !editor
            .state()
            .view()
            .export_json(key)?
            .contains_key("stored-value")
    );
    assert_eq!(
        editor.state().view().export_stored_json(key)?["stored-value"],
        json!({"n":0})
    );
    assert!(
        !editor
            .state()
            .view()
            .export_stored_json(key)?
            .contains_key("$")
    );
    let mut other = imported()?;
    other.state().view().get_state(NodeKey::ROOT, &VALUE)?;
    let parsed = other.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"$":{"stored-value":{"n":6}},"children":[{"type":"paragraph","children":[]}]}}"#)?;
    assert_eq!(parsed.view().get_state(NodeKey::ROOT, &VALUE)?, 6);
    assert_eq!(
        parsed.view().export_stored_json(NodeKey::ROOT)?["$"]["stored-value"],
        json!({"n":6})
    );
    let missing = other.parse_editor_state_str(
        r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","children":[]}]}}"#,
    )?;
    assert_eq!(missing.view().get_state(NodeKey::ROOT, &VALUE)?, 0);
    assert!(
        !missing
            .view()
            .export_stored_json(NodeKey::ROOT)?
            .contains_key("$")
    );
    Ok(())
}

#[test]
fn copy_reset_invalidates_only_reset_keys_and_reused_buffers_are_cleared()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let (key, _) = editor.update(|tx| {
        let node = tx.import_node(
            json!({"type":"paragraph","children":[],"$":{"stored-value":{"n":4},"reset":{"n":3}}})
                .as_object()
                .expect("literal node"),
        )?;
        tx.append(NodeKey::ROOT, &[node])?;
        tx.get_state(node, &RESET)?;
        tx.get_state(node, &VALUE)?;
        Ok(node)
    })?;
    let (copy, _) = editor.update(|tx| {
        let copy = tx.copy_node(key, false)?;
        tx.append(NodeKey::ROOT, &[copy])?;
        Ok(copy)
    })?;
    assert_eq!(
        editor.state().view().export_stored_json(copy)?["$"],
        json!({"stored-value":{"n":4}})
    );
    assert_eq!(
        editor.state().view().export_stored_json(key)?["$"]["reset"],
        json!({"n":3})
    );
    let buffer = editor
        .state()
        .view()
        .export_stored_json_reusing(key, JsonExportBuffer::default())?;
    let buffer = editor
        .state()
        .view()
        .export_stored_json_reusing(NodeKey::ROOT, buffer)?;
    assert!(!buffer.json().contains_key("$"));
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Custom {}
impl NodeType for Custom {
    const TYPE: &'static str = "stored-custom";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for Custom {
    decorator_node_base!();
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        // A nested ordinary super export remains canonical, even inside stored export.
        assert_eq!(
            node.state.export_framework_json(node.key)?["$"]["stored-value"],
            4
        );
        json.insert("$".into(), json!({"custom":"authoritative"}));
        Ok(())
    }
}

#[test]
fn final_custom_export_override_remains_authoritative() -> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Custom>()
        .build()?;
    let (key, _) = editor.update(|tx| {
        let node = tx.import_node(
            json!({"type":"stored-custom","$":{"stored-value":{"n":4}}})
                .as_object()
                .expect("literal node"),
        )?;
        tx.append(NodeKey::ROOT, &[node])?;
        tx.get_state(node, &VALUE)?;
        Ok(node)
    })?;
    assert_eq!(
        editor.state().view().export_stored_json(key)?["$"],
        json!({"custom":"authoritative"})
    );
    assert_eq!(
        editor.state().view().export_json(key)?["$"],
        json!({"custom":"authoritative"})
    );
    Ok(())
}
