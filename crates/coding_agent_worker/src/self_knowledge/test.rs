use super::*;
use serde_json::json;

#[test]
fn every_session_with_macros_server_gets_macrods_and_is_told_about_it() {
    let mut self_knowledge = SelfKnowledge::new(Some(LocalServer {
        program: "/opt/macrod/bin/macrod".into(),
        web_url: "https://macro.com/app".to_owned(),
    }));
    let macro_server = json!({
        "type": "http",
        "name": "macro",
        "url": "https://egress.macro.com/mcp-macro",
        "headers": [{"name": "Authorization", "value": "Bearer session-token"}]
    });
    let mut open = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/new",
        "params": {"cwd": "/home/operator/code", "mcpServers": [macro_server]}
    });
    self_knowledge.outbound(&mut open);
    self_knowledge.inbound(&json!({"jsonrpc": "2.0", "id": 1, "result": {"sessionId": "acp-1"}}));
    let mut first = json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
        "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "hello"}]}
    });
    self_knowledge.outbound(&mut first);
    let mut resume = json!({
        "jsonrpc": "2.0", "id": 3, "method": "session/resume",
        "params": {"sessionId": "acp-2", "cwd": "/home/operator/code", "mcpServers": [macro_server]}
    });
    self_knowledge.outbound(&mut resume);

    assert_eq!(open["params"]["mcpServers"][1]["name"], "macrod");
    assert_eq!(resume["params"]["mcpServers"][1]["name"], "macrod");
    let expected = render(&SessionFacts {
        workspace: "/home/operator/code".to_owned(),
        mcp_servers: vec!["macro".to_owned()],
        permission_bypass: false,
        artifacts: true,
    });
    assert_eq!(first["params"]["prompt"][0]["text"], expected);
}

#[test]
fn renders_every_enabled_capability() {
    let section = render(&SessionFacts {
        workspace: "/home/operator/code".to_owned(),
        mcp_servers: vec!["macro".to_owned(), "linear".to_owned()],
        permission_bypass: true,
        artifacts: true,
    });

    assert_eq!(
        section,
        format!(
            "<macrod-runtime>\n\
             You are running through macrod {}, the Macro agent daemon on the operator's own {} machine. \
             Macro users reach you from Macro (channels, documents, agent sessions); each prompt arrives \
             through macrod, and your replies stream back to Macro.\n\
             - Workspace: you work in `/home/operator/code` on the operator's machine. Changes there are real.\n\
             - MCP servers forwarded from Macro: macro, linear. Use them to read and act in the Macro workspace; \
             for questions about Macro itself, call its SelfKnowledge tool.\n\
             - Artifacts: to show people a page, prototype or UI mock-up, write it as files in the \
             workspace and publish them with macrod's PublishArtifact tool; it uploads from disk, \
             so never read the files back into the conversation. Its description says how to \
             reproduce the user's own UI.\n\
             - Permission bypass: Macro approves your tool permission requests automatically; \
             no one is asked before you run commands or edit files.\n\
             </macrod-runtime>",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
        )
    );
}

#[test]
fn leaves_out_capabilities_the_session_does_not_have() {
    let section = render(&SessionFacts {
        workspace: "/home/operator/code".to_owned(),
        mcp_servers: Vec::new(),
        permission_bypass: false,
        artifacts: false,
    });

    assert!(section.contains("Workspace: you work in `/home/operator/code`"));
    assert!(!section.contains("MCP servers"));
    assert!(!section.contains("Permission bypass"));
    assert!(!section.contains("Artifacts"));
}

#[test]
fn only_a_new_sessions_first_prompt_carries_the_runtime_section() {
    let mut self_knowledge = SelfKnowledge::default();
    let mut open = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/new",
        "params": {
            "cwd": "/home/operator/code",
            "mcpServers": [{"type": "http", "name": "macro", "url": "https://example.test/mcp", "headers": []}],
            "_meta": {"macro.com/permissionPolicy": "autoAccept"}
        }
    });
    self_knowledge.outbound(&mut open);
    self_knowledge.inbound(&json!({"jsonrpc": "2.0", "id": 1, "result": {"sessionId": "acp-1"}}));

    let mut first = json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
        "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "hello"}]}
    });
    self_knowledge.outbound(&mut first);
    let mut second = json!({
        "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
        "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "again"}]}
    });
    self_knowledge.outbound(&mut second);

    let expected = render(&SessionFacts {
        workspace: "/home/operator/code".to_owned(),
        mcp_servers: vec!["macro".to_owned()],
        permission_bypass: true,
        artifacts: false,
    });
    assert_eq!(
        first["params"]["prompt"],
        json!([{"type": "text", "text": expected}, {"type": "text", "text": "hello"}])
    );
    assert_eq!(
        second["params"]["prompt"],
        json!([{"type": "text", "text": "again"}])
    );
}

#[test]
fn a_loaded_session_is_not_taught_again() {
    let mut self_knowledge = SelfKnowledge::default();
    let mut load = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/load",
        "params": {"sessionId": "acp-1", "cwd": "/home/operator/code", "mcpServers": []}
    });
    self_knowledge.outbound(&mut load);
    self_knowledge.inbound(&json!({"jsonrpc": "2.0", "id": 1, "result": {}}));

    let mut prompt = json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/prompt",
        "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "hello"}]}
    });
    self_knowledge.outbound(&mut prompt);

    assert_eq!(
        prompt["params"]["prompt"],
        json!([{"type": "text", "text": "hello"}])
    );
}
