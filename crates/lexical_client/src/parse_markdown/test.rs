use super::*;

#[test]
fn connection_prompt_matches_the_lexical_service_request() {
    let prompt = AgentConnectionPrompt {
        agent_tag: "@claude".into(),
        message: "Connect Claude, then mention me again.".into(),
        chip: AgentConnectionChip {
            app_slug: "claude-cloud".into(),
            name: "Claude".into(),
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
                "agentTag": "@claude",
                "message": "Connect Claude, then mention me again.",
                "chip": { "appSlug": "claude-cloud", "name": "Claude", "target": "harness" }
            }
        })
    );
}
