use super::*;

const CREDENTIAL: &str = "Bearer placeholder-session-credential";

#[test]
fn graphql_session_opening_entry_removes_credentials() {
    let session = AgentSessionId::new();
    let message = serde_json::from_value(serde_json::json!({
        "type": "acp", "jsonrpc": "2.0", "id": 1, "method": "session/new",
        "params": {"cwd": "/workspace", "mcpServers": [{"type": "http", "name": "macro", "url": "https://egress.example.test/mcp-macro", "headers": [{"name": "Authorization", "value": CREDENTIAL}]}]}
    }))
    .unwrap();
    let entry = GraphqlAgentSessionLogEntry::try_from(StoredAgentSessionLog {
        id: Uuid::from_u128(1),
        created_at: chrono::Utc::now(),
        entry: agent_session::domain::model::AgentSessionLog {
            agent_session_id: session,
            user_id: None,
            content: agent_session::domain::model::Message::ToRuntime(message),
            logged_at: None,
        },
    })
    .unwrap();

    let encoded = serde_json::to_string(&entry.content.0).unwrap();
    assert!(!encoded.contains(CREDENTIAL));
    assert_eq!(
        entry.content.0["params"]["mcpServers"],
        serde_json::json!([])
    );
}

#[test]
fn email_message_pagination_uses_rest_compatible_defaults() {
    assert_eq!(parse_email_message_pagination(None, None).unwrap(), (0, 5));
}

#[test]
fn email_message_pagination_accepts_valid_values() {
    assert_eq!(
        parse_email_message_pagination(Some(7), Some(20)).unwrap(),
        (7, 20)
    );
}

#[test]
fn email_message_pagination_rejects_invalid_values() {
    assert_eq!(
        parse_email_message_pagination(Some(-1), None)
            .unwrap_err()
            .message,
        "offset must be non-negative"
    );
    assert_eq!(
        parse_email_message_pagination(None, Some(0))
            .unwrap_err()
            .message,
        "limit must be positive"
    );
    assert_eq!(
        parse_email_message_pagination(None, Some(101))
            .unwrap_err()
            .message,
        "limit must not exceed 100"
    );
}
