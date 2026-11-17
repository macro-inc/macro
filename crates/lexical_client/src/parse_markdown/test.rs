use super::*;

#[test]
fn connection_prompt_matches_the_lexical_service_request() {
    let prompt = AgentConnectionPrompt {
        agent_tag: "@codex".into(),
        message: "Connect Codex, then mention me again.".into(),
        chip: AgentConnectionChip {
            app_slug: "codex-cloud".into(),
            name: "Codex".into(),
            target: "harness".into(),
        },
    };
    let wire = serde_json::to_value(AgentConnectionPromptRequest {
        connection_prompt: &prompt,
    })
    .unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "connectionPrompt": {
                "agentTag": "@codex",
                "message": "Connect Codex, then mention me again.",
                "chip": { "appSlug": "codex-cloud", "name": "Codex", "target": "harness" }
            }
        })
    );
}

#[test]
fn mentions_request_sends_the_app_origin_only_for_documents() {
    let message = serde_json::to_value(MentionsRequest {
        markdown: "hi",
        app_origin: None,
    })
    .unwrap();
    assert_eq!(message, serde_json::json!({ "markdown": "hi" }));

    let document = serde_json::to_value(MentionsRequest {
        markdown: "hi",
        app_origin: Some("https://macro.com"),
    })
    .unwrap();
    assert_eq!(
        document,
        serde_json::json!({ "markdown": "hi", "appOrigin": "https://macro.com" })
    );
}

#[test]
fn markdown_snapshot_request_sends_the_app_origin() {
    let wire = serde_json::to_value(MarkdownSnapshotRequest {
        markdown: "hi",
        app_origin: "https://dev.macro.com",
    })
    .unwrap();
    assert_eq!(
        wire,
        serde_json::json!({ "markdown": "hi", "appOrigin": "https://dev.macro.com" })
    );
}
