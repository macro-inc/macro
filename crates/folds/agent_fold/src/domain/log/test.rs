use super::*;
use agent_client_protocol::schema::v1::{
    LoadSessionRequest, NewSessionRequest, ResumeSessionRequest,
};
use serde_json::json;

const CREDENTIAL: &str = "Bearer placeholder-session-credential";

fn opening_frame(method: &str) -> ToRuntimeMessage {
    serde_json::from_value(json!({
        "type": "acp",
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": {
            "sessionId": "acp-session",
            "cwd": "/workspace",
            "additionalDirectories": [],
            "futureSecret": CREDENTIAL,
            "mcpServers": [
                {
                    "type": "http",
                    "name": "macro",
                    "url": "https://egress.example.com/mcp-macro",
                    "headers": [{"name": "Authorization", "value": CREDENTIAL}],
                },
                {
                    "type": "sse",
                    "name": "events",
                    "url": "https://egress.example.com/mcp/events",
                    "headers": [{"name": "X-Api-Key", "value": CREDENTIAL}],
                },
                {
                    "name": "local",
                    "command": "server",
                    "args": ["--token", CREDENTIAL],
                    "env": [{"name": "TOKEN", "value": CREDENTIAL}],
                },
            ],
            "_meta": {
                MACRO_AGENT_SESSION_META_KEY: "session",
                MACRO_PERMISSION_POLICY_META_KEY: "prompt",
                "futureSecret": CREDENTIAL,
            },
        },
    }))
    .unwrap()
}

#[test]
fn serializing_a_session_opening_keeps_no_credential_in_either_direction() {
    for method in SESSION_OPENING_METHODS {
        for message in [
            Message::ToRuntime(opening_frame(method)),
            Message::Notification(opening_frame(method)),
        ] {
            let encoded = serde_json::to_string(&message).unwrap();

            assert!(!encoded.contains(CREDENTIAL), "{method}");
            assert!(!encoded.contains("futureSecret"), "{method}");
            assert!(!encoded.contains("egress.example.com"), "{method}");
        }
    }
}

#[test]
fn a_stored_session_opening_keeps_what_the_fold_reads() {
    let stored = serde_json::to_value(Message::ToRuntime(opening_frame("session/resume"))).unwrap();

    assert_eq!(
        stored["content"]["params"],
        json!({
            "sessionId": "acp-session",
            "cwd": "/workspace",
            "additionalDirectories": [],
            "mcpServers": [],
            "_meta": {
                MACRO_AGENT_SESSION_META_KEY: "session",
                MACRO_PERMISSION_POLICY_META_KEY: "prompt",
            },
        }),
    );
}

#[test]
fn a_stored_session_opening_still_parses_as_its_request() {
    let params = |method| {
        let stored = serde_json::to_value(Message::ToRuntime(opening_frame(method))).unwrap();
        stored["content"]["params"].clone()
    };

    serde_json::from_value::<NewSessionRequest>(params("session/new")).unwrap();
    serde_json::from_value::<LoadSessionRequest>(params("session/load")).unwrap();
    serde_json::from_value::<ResumeSessionRequest>(params("session/resume")).unwrap();
}

#[test]
fn a_method_nobody_has_reviewed_is_stored_without_its_params() {
    let frame: ToRuntimeMessage = serde_json::from_value(json!({
        "type": "acp",
        "jsonrpc": "2.0",
        "id": 1,
        "method": "_macro/new_frame",
        "params": {"headers": [{"name": "X-Key", "value": CREDENTIAL}]},
    }))
    .unwrap();

    let stored = serde_json::to_value(Message::ToRuntime(frame)).unwrap();

    assert_eq!(stored["content"]["method"], "_macro/new_frame");
    assert_eq!(stored["content"]["params"], json!({}));
}

#[test]
fn reviewed_methods_are_stored_whole() {
    let params = json!({
        "sessionId": "acp-session",
        "prompt": [{"type": "text", "text": "hello"}],
        "_meta": {"macro.dev/notifications": []},
    });
    let frame: ToRuntimeMessage = serde_json::from_value(json!({
        "type": "acp",
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": params,
    }))
    .unwrap();

    let stored = serde_json::to_value(Message::ToRuntime(frame)).unwrap();

    assert_eq!(stored["content"]["params"], params);
}

#[test]
fn a_response_to_the_runtime_is_stored_whole() {
    let result = json!({"outcome": {"outcome": "selected", "optionId": "allow"}});
    let frame: ToRuntimeMessage = serde_json::from_value(json!({
        "type": "acp",
        "jsonrpc": "2.0",
        "id": 1,
        "result": result,
    }))
    .unwrap();

    let stored = serde_json::to_value(Message::ToRuntime(frame)).unwrap();

    assert_eq!(stored["content"]["result"], result);
}

#[test]
fn redacting_twice_changes_nothing() {
    let mut once = serde_json::to_value(Message::ToRuntime(opening_frame("session/load"))).unwrap()
        ["content"]
        .clone();
    let expected = once.clone();

    redact_stored_frame(&mut once);

    assert_eq!(once, expected);
}

#[test]
fn a_redacted_message_holds_no_credential_in_memory() {
    let message = Message::ToRuntime(opening_frame("session/new"))
        .redacted()
        .unwrap();

    assert!(!format!("{message:?}").contains(CREDENTIAL));
}
