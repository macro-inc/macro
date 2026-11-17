use super::*;

#[test]
fn an_unverified_client_is_named_as_unverified() {
    let label = McpClientLabel {
        name: "Claude".to_owned(),
        kind: None,
    };
    assert_eq!(label.display_name(), "Claude (unverified app)");
}

#[test]
fn a_verified_client_keeps_its_name() {
    let label = McpClientLabel {
        name: "Claude Code".to_owned(),
        kind: Some(McpClientKind::ClaudeCode),
    };
    assert_eq!(label.display_name(), "Claude Code");
}
