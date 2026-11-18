//! Literal pristine Source root-state export order through the application factory.
#![cfg(feature = "application")]
use document_session::{EditorConfig, application_editor_config};
use lexical_model::{Editor, EditorMode, NodeKey, SerializedEditorState};
use macro_document_model::EditorType;
use serde_json::Value;
use std::sync::{Arc, atomic::AtomicI64};

#[test]
fn application_root_state_order_matches_the_actual_source_golden()
-> Result<(), Box<dyn std::error::Error>> {
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(1000)),
        EditorType::MarkdownSync,
    );
    let editor = (config.builder)(EditorMode::ViewAttached, 77)
        .initial_state(serde_json::from_str(include_str!(
            "corpus/root_state_order_input.json"
        ))?)
        .build()?;
    let source: Value = serde_json::from_str(include_str!("corpus/root_state_order_output.json"))?;
    let expected = source["root"]["$"].to_string();
    let direct = editor.state().view().export_json(NodeKey::ROOT)?;
    assert_eq!(direct["$"].to_string(), expected);
    let value = serde_json::to_value(editor.state().to_json()?)?;
    assert_eq!(value["root"]["$"].to_string(), expected);
    let streamed: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert_eq!(streamed["root"]["$"].to_string(), expected);
    assert_eq!(editor.state().to_json_string()?, source.to_string());
    assert_eq!(value.to_string(), source.to_string());
    Ok(())
}

#[test]
fn unconfigured_root_state_export_retains_its_original_unknown_order()
-> Result<(), Box<dyn std::error::Error>> {
    let mut input: SerializedEditorState =
        serde_json::from_str(include_str!("corpus/root_state_order_input.json"))?;
    input.root.insert("children".into(), serde_json::json!([]));
    let expected = input.root["$"].to_string();
    let editor = Editor::builder(EditorMode::ViewAttached)
        .initial_state(input)
        .build()?;
    assert_eq!(
        editor.state().view().export_json(NodeKey::ROOT)?["$"].to_string(),
        expected
    );
    let streamed: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert_eq!(streamed["root"]["$"].to_string(), expected);
    Ok(())
}
