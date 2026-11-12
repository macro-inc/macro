use serde_json::json;

use super::*;

fn session_new() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "session/new",
        "params": {
            "cwd": "/home/macro/work",
            "mcpServers": [
                { "type": "http", "name": "github", "url": "https://example.test/mcp", "headers": [] },
                {
                    "type": "http",
                    "name": "macro_internal",
                    "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp/internal",
                    "headers": [{ "name": "Authorization", "value": "Bearer egress-token" }]
                }
            ],
            "_meta": { "claudeCode": { "options": { "env": { "KEEP": "me" } } } }
        }
    })
}

#[test]
fn sessions_point_claude_code_at_the_gateway_of_the_sessions_internal_mcp() {
    let mut frame = session_new();
    prepare_session(&mut frame, std::path::Path::new("/home/macro/work"), None).unwrap();
    assert_eq!(
        frame["params"]["_meta"]["claudeCode"]["options"]["env"],
        json!({
            "KEEP": "me",
            "ANTHROPIC_BASE_URL": "https://dev-gateway.macro.com/agent-harness-egress/anthropic",
            "ANTHROPIC_AUTH_TOKEN": "egress-token",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
        })
    );
}

#[test]
fn only_session_starts_are_touched() {
    let mut prompt = json!({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "session/prompt",
        "params": { "sessionId": "s", "prompt": [] }
    });
    let before = prompt.clone();
    prepare_session(&mut prompt, std::path::Path::new("/home/macro/work"), None).unwrap();
    assert_eq!(prompt, before);

    // Without the internal MCP server there is no gateway to point at.
    let mut bare = json!({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "session/load",
        "params": { "sessionId": "s", "cwd": "/", "mcpServers": [] }
    });
    let before = bare.clone();
    assert!(prepare_session(&mut bare, std::path::Path::new("/home/macro/work"), None).is_err());
    assert_eq!(bare, before);
}

#[test]
fn each_attach_takes_the_current_gateway_credentials() {
    let mut frame = session_new();
    prepare_session(&mut frame, std::path::Path::new("/home/macro/work"), None).unwrap();

    frame["method"] = json!("session/load");
    frame["params"]["mcpServers"][1]["headers"][0]["value"] = json!("Bearer fresh-token");
    frame["params"]["_meta"]["claudeCode"]["options"]["env"]["CLAUDE_CODE_OAUTH_TOKEN"] =
        json!("stale");
    prepare_session(&mut frame, std::path::Path::new("/home/macro/work"), None).unwrap();
    let env = &frame["params"]["_meta"]["claudeCode"]["options"]["env"];
    assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "fresh-token");
    assert!(env.get("CLAUDE_CODE_OAUTH_TOKEN").is_none());
}

#[test]
fn computer_sessions_use_the_guest_workspace_and_egress_route() {
    for method in SESSION_METHODS {
        let mut frame = session_new();
        frame["method"] = json!(method);
        frame["params"]["cwd"] = json!("/workspace");
        frame["params"]["mcpServers"].as_array_mut().unwrap().push(json!({
            "type": "http", "name": "macro-preview", "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp-preview", "headers": []
        }));
        prepare_session(
            &mut frame,
            std::path::Path::new("/home/macro/work"),
            Some("http://10.210.0.1:41027/"),
        )
        .unwrap();
        assert_eq!(frame["params"]["cwd"], "/home/macro/work");
        assert_eq!(
            frame["params"]["mcpServers"][0]["url"],
            "https://example.test/mcp"
        );
        assert_eq!(
            frame["params"]["mcpServers"][1]["url"],
            "http://10.210.0.1:41027/mcp/internal"
        );
        assert_eq!(
            frame["params"]["mcpServers"][2]["url"],
            "http://10.210.0.1:41027/mcp-preview"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_BASE_URL"],
            "http://10.210.0.1:41027/anthropic"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            "egress-token"
        );
    }
    let mut explicit = session_new();
    prepare_session(
        &mut explicit,
        std::path::Path::new("/home/macro/other"),
        None,
    )
    .unwrap();
    assert_eq!(explicit["params"]["cwd"], "/home/macro/work");
}
