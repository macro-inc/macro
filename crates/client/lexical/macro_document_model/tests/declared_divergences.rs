//! Explicit S3 section 4.1b open-item defaults, separate from the exact valid-node oracle.
use lexical_model::*;
use macro_document_model::*;
#[test]
fn divergence_magic_chip_status_rejects_unknown_enum_values() -> Result<()> {
    let mut editor = export_registry();
    let input = r#"{"root":{"type":"root","children":[{"type":"magic-chip","agentSessionId":"session","status":"acp_ready"}]}}"#;
    assert!(editor.parse_editor_state_str(input).is_ok());
    let unknown = input.replace("acp_ready", "future_status");
    assert!(matches!(
        editor.parse_editor_state_str(&unknown),
        Err(lexical_model::Error::Json(_))
    ));
    Ok(())
}
#[test]
fn divergence_reply_target_parent_keys_drops_unknown_parent_fields() -> Result<()> {
    let mut editor = export_registry();
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","children":[{"type":"reply-target","version":2,"parent":{"type":"channel","id":"channel","future":7},"targetMessageId":"message","targetThreadId":"thread","displayText":"Reply","senderId":"sender"}]}}"#)?;
    let key = state.first_child(NodeKey::ROOT).unwrap();
    assert_eq!(
        state.export_json(key)?["parent"],
        serde_json::json!({"type":"channel", "id":"channel"})
    );
    Ok(())
}
