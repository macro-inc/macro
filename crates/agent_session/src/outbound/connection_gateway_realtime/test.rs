use super::*;
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;

const CREDENTIAL: &str = "Bearer placeholder-session-credential";

#[test]
fn session_opening_event_serialization_removes_credentials() {
    let message: ToRuntimeMessage = serde_json::from_value(serde_json::json!({
        "type": "acp", "jsonrpc": "2.0", "id": 1, "method": "session/new",
        "params": {"cwd": "/workspace", "mcpServers": [{"type": "http", "name": "macro", "url": "https://egress.example.test/mcp-macro", "headers": [{"name": "Authorization", "value": CREDENTIAL}]}]}
    }))
    .unwrap();
    let event = AgentSessionLogEvent::new(LogAppended {
        turn_state: None,
        agent_session_id: AgentSessionId::TEST_A,
        entries: vec![StoredAgentSessionLog {
            id: Uuid::from_u128(1),
            created_at: chrono::Utc::now(),
            entry: AgentSessionLog {
                agent_session_id: AgentSessionId::TEST_A,
                user_id: None,
                content: Message::ToRuntime(message),
                logged_at: None,
            },
        }],
    });

    let encoded = serde_json::to_string(&event).unwrap();
    assert!(!encoded.contains(CREDENTIAL));
    let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(
        value["entries"][0]["content"]["params"]["mcpServers"],
        serde_json::json!([])
    );
}
