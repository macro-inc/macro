use mcp_client_label::McpClientKind;

use super::classify;

fn uris(uris: &[&str]) -> Vec<String> {
    uris.iter().map(|uri| uri.to_string()).collect()
}

#[test]
fn claude_on_claude_ai_is_claude() {
    assert_eq!(
        classify(
            "Claude",
            &uris(&["https://claude.ai/api/mcp/auth_callback"])
        ),
        Some(McpClientKind::Claude)
    );
}

#[test]
fn claude_with_a_callback_elsewhere_is_unknown() {
    assert_eq!(
        classify("Claude", &uris(&["https://evil.example/callback"])),
        None
    );
    assert_eq!(
        classify(
            "Claude",
            &uris(&[
                "https://claude.ai/api/mcp/auth_callback",
                "https://evil.example/callback",
            ])
        ),
        None
    );
}

#[test]
fn claude_on_loopback_is_unknown() {
    assert_eq!(
        classify("Claude", &uris(&["http://localhost:6274/callback"])),
        None
    );
}

#[test]
fn claude_on_a_lookalike_host_is_unknown() {
    assert_eq!(
        classify(
            "Claude",
            &uris(&["https://claude.ai.evil.example/callback"])
        ),
        None
    );
    assert_eq!(
        classify("Claude", &uris(&["https://notclaude.ai/callback"])),
        None
    );
    assert_eq!(
        classify("Claude", &uris(&["http://claude.ai/api/mcp/auth_callback"])),
        None
    );
}

#[test]
fn claude_code_names_its_server_in_parentheses() {
    for name in [
        "Claude Code",
        "Claude Code (macro)",
        "Claude Code (Macro)",
        "claude code (work)",
    ] {
        assert_eq!(
            classify(name, &uris(&["http://localhost:53581/callback"])),
            Some(McpClientKind::ClaudeCode),
            "{name}"
        );
    }
}

#[test]
fn claude_code_off_loopback_is_unknown() {
    assert_eq!(
        classify(
            "Claude Code (macro)",
            &uris(&["https://evil.example/callback"])
        ),
        None
    );
}

#[test]
fn chatgpt_on_its_hosts_is_chatgpt() {
    assert_eq!(
        classify(
            "ChatGPT",
            &uris(&["https://chatgpt.com/connector_platform_oauth_redirect"])
        ),
        Some(McpClientKind::ChatGpt)
    );
    assert_eq!(
        classify("ChatGPT", &uris(&["https://chat.openai.com/aip/callback"])),
        Some(McpClientKind::ChatGpt)
    );
}

#[test]
fn cursor_registers_loopback_and_its_site_together() {
    assert_eq!(
        classify(
            "Cursor",
            &uris(&[
                "http://127.0.0.1:41234/callback",
                "https://www.cursor.com/oauth/callback",
            ])
        ),
        Some(McpClientKind::Cursor)
    );
    assert_eq!(
        classify("Cursor", &uris(&["https://cursor.com/oauth/callback"])),
        Some(McpClientKind::Cursor)
    );
}

#[test]
fn native_clients_on_loopback_are_recognized() {
    assert_eq!(
        classify("Codex", &uris(&["http://localhost:1455/auth/callback"])),
        Some(McpClientKind::Codex)
    );
    assert_eq!(
        classify(
            "OpenCode",
            &uris(&["http://127.0.0.1:19876/mcp/oauth/callback"])
        ),
        Some(McpClientKind::OpenCode)
    );
    assert_eq!(
        classify(
            "opencode",
            &uris(&["http://[::1]:19876/mcp/oauth/callback"])
        ),
        Some(McpClientKind::OpenCode)
    );
}

#[test]
fn unknown_names_get_no_kind() {
    assert_eq!(
        classify("Hermes Agent", &uris(&["http://localhost:8080/callback"])),
        None
    );
    assert_eq!(
        classify("Claude Coder", &uris(&["http://localhost:8080/callback"])),
        None
    );
    assert_eq!(
        classify("MCP client", &uris(&["http://localhost:8080/callback"])),
        None
    );
}

#[test]
fn a_registration_without_redirect_uris_gets_no_kind() {
    assert_eq!(classify("Claude", &[]), None);
    assert_eq!(classify("Codex", &[]), None);
}

#[test]
fn unparseable_redirect_uris_get_no_kind() {
    assert_eq!(classify("Codex", &uris(&["not a uri"])), None);
    assert_eq!(
        classify("Codex", &uris(&["cursor://anysphere/callback"])),
        None
    );
}
