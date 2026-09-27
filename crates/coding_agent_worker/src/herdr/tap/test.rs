use agent_client_protocol::LineDirection::{Stderr, Stdin, Stdout};
use serde_json::json;

use super::*;

fn line(value: Value) -> String {
    value.to_string()
}

#[test]
fn session_new_answer_opens_the_session_with_its_macro_id() {
    let mut tap = WireTap::default();
    let macro_id = "0195d2dd-5de9-71f2-9d59-5d9734f1adb7";
    let request = line(json!({
        "jsonrpc": "2.0", "id": 7, "method": "session/new",
        "params": {"cwd": "/repo", "mcpServers": [], "_meta": {MACRO_AGENT_SESSION_META_KEY: macro_id}}
    }));
    assert!(tap.observe(&request, Stdin).is_empty());

    let answer = line(json!({"jsonrpc": "2.0", "id": 7, "result": {"sessionId": "acp-1"}}));
    assert_eq!(
        tap.observe(&answer, Stdout),
        [TapEvent::Opened {
            session: "acp-1".to_owned(),
            macro_session: Some(AgentSessionId::new_from_uuid(
                uuid::Uuid::parse_str(macro_id).unwrap()
            )),
        }]
    );
}

#[test]
fn session_new_without_meta_opens_an_unnamed_session() {
    let mut tap = WireTap::default();
    tap.observe(
        &line(json!({"jsonrpc": "2.0", "id": "a", "method": "session/new", "params": {"cwd": "/"}})),
        Stdin,
    );
    assert_eq!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "id": "a", "result": {"sessionId": "acp-2"}})),
            Stdout
        ),
        [TapEvent::Opened {
            session: "acp-2".to_owned(),
            macro_session: None,
        }]
    );
}

#[test]
fn load_names_the_session_directly() {
    let mut tap = WireTap::default();
    let events = tap.observe(
        &line(json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/load",
            "params": {"sessionId": "acp-3", "cwd": "/", "mcpServers": []}
        })),
        Stdin,
    );
    assert_eq!(
        events,
        [TapEvent::Opened {
            session: "acp-3".to_owned(),
            macro_session: None,
        }]
    );
}

#[test]
fn a_prompt_turn_runs_until_its_answer() {
    let mut tap = WireTap::default();
    let prompt = line(json!({
        "jsonrpc": "2.0", "id": 9, "method": "session/prompt",
        "params": {"sessionId": "acp-1", "prompt": [
            {"type": "text", "text": "fix the bug"},
            {"type": "resource_link", "uri": "file:///a", "name": "a"},
            {"type": "text", "text": "please"}
        ]}
    }));
    assert_eq!(
        tap.observe(&prompt, Stdin),
        [TapEvent::Prompted {
            session: "acp-1".to_owned(),
            text: "fix the bug\nplease".to_owned(),
        }]
    );

    let update = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "on it"}});
    assert_eq!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "acp-1", "update": update}})),
            Stdout
        ),
        [TapEvent::Update {
            session: "acp-1".to_owned(),
            update,
        }]
    );

    assert_eq!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "id": 9, "result": {"stopReason": "end_turn"}})),
            Stdout
        ),
        [TapEvent::TurnEnded {
            session: "acp-1".to_owned(),
            stop_reason: "end_turn".to_owned(),
        }]
    );
}

#[test]
fn a_failed_prompt_ends_the_turn_as_an_error() {
    let mut tap = WireTap::default();
    tap.observe(
        &line(json!({"jsonrpc": "2.0", "id": 2, "method": "session/prompt", "params": {"sessionId": "s", "prompt": []}})),
        Stdin,
    );
    assert_eq!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "id": 2, "error": {"code": -32603, "message": "boom"}})),
            Stdout
        ),
        [TapEvent::TurnEnded {
            session: "s".to_owned(),
            stop_reason: "error".to_owned(),
        }]
    );
}

#[test]
fn a_permission_request_blocks_until_answered() {
    let mut tap = WireTap::default();
    let ask = line(json!({
        "jsonrpc": "2.0", "id": 0, "method": "session/request_permission",
        "params": {"sessionId": "acp-1", "toolCall": {"toolCallId": "t", "title": "Run rm -rf"}, "options": [
            {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
            {"optionId": "reject", "name": "Reject", "kind": "reject_once"}
        ]}
    }));
    assert_eq!(
        tap.observe(&ask, Stdout),
        [TapEvent::PermissionAsked {
            session: "acp-1".to_owned(),
            request_id: json!(0),
            title: Some("Run rm -rf".to_owned()),
            options: vec![
                PermissionChoice {
                    option_id: "allow".to_owned(),
                    name: "Allow".to_owned(),
                    kind: "allow_once".to_owned(),
                },
                PermissionChoice {
                    option_id: "reject".to_owned(),
                    name: "Reject".to_owned(),
                    kind: "reject_once".to_owned(),
                },
            ],
        }]
    );
    // The agent's own request ids live in a separate space from the
    // client's: the same id answered on stdin is the permission answer.
    assert_eq!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "cancelled"}}})),
            Stdin
        ),
        [TapEvent::PermissionAnswered {
            session: "acp-1".to_owned(),
        }]
    );
}

#[test]
fn stderr_and_noise_are_ignored() {
    let mut tap = WireTap::default();
    assert!(tap.observe("{\"method\":\"session/update\"}", Stderr).is_empty());
    assert!(tap.observe("not json", Stdout).is_empty());
    assert!(
        tap.observe(
            &line(json!({"jsonrpc": "2.0", "id": 99, "result": {}})),
            Stdout
        )
        .is_empty()
    );
}
