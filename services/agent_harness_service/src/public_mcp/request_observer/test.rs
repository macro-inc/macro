use serde_json::json;

use super::*;
use crate::public_mcp::test_support::MemoryStore;

#[test]
fn handoffs_are_read_from_a_setup_connect_result() {
    let result = json!({
        "handoffs": [
            { "app": "notion", "kind": "connect", "url": "https://macro.com/app/connect/notion" },
            { "app": "gmail", "kind": "connect_inbox", "url": "https://macro.com/app/connect/gmail" },
            { "url": "https://macro.com/app/connect/broken" }
        ],
        "next_step": "Show the user the links."
    });

    assert_eq!(
        handoffs(&result),
        vec![
            ("notion".to_owned(), "connect".to_owned()),
            ("gmail".to_owned(), "connect_inbox".to_owned()),
        ]
    );
}

#[test]
fn a_result_without_handoffs_has_none() {
    assert!(handoffs(&json!({ "next_step": "Done." })).is_empty());
}

#[tokio::test]
async fn the_handshake_attributes_the_token_for_later_tool_calls() {
    let attribution = ClientAttribution::new(MemoryStore::default());
    let observer = Arc::new(TelemetryObserver::new(
        McpTelemetry::disabled(),
        attribution.clone(),
    ));
    let client = ClientInfo {
        name: Some("codex-mcp-client".to_owned()),
        version: Some("0.162.1".to_owned()),
        user_agent: Some("codex_cli_rs/0.162.1".to_owned()),
    };

    observer
        .initialized(InitializeSeen {
            user_id: "macro|a@example.com".to_owned(),
            token: Some("token-a".to_owned()),
            client: client.clone(),
            protocol_version: "2025-06-18".to_owned(),
        })
        .await;

    assert_eq!(
        attribution
            .client_for("token-a", "macro|a@example.com")
            .await,
        Some(client)
    );
}
