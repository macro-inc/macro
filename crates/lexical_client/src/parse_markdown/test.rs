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
fn markdown_snapshot_options_preserve_omitted_and_empty_pins() {
    let omitted = serde_json::to_value(MarkdownSnapshotRequest {
        markdown: "",
        initial_pins: MarkdownSnapshotOptions::default().initial_pins.as_deref(),
    })
    .unwrap();
    assert_eq!(omitted, serde_json::json!({ "markdown": "" }));

    let explicit = MarkdownSnapshotOptions {
        initial_pins: Some(vec![]),
    };
    let empty = serde_json::to_value(MarkdownSnapshotRequest {
        markdown: "",
        initial_pins: explicit.initial_pins.as_deref(),
    })
    .unwrap();
    assert_eq!(
        empty,
        serde_json::json!({ "markdown": "", "initial_pins": [] })
    );
}
