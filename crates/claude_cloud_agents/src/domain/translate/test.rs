use super::*;
use serde_json::json;
fn event(kind: &str, payload: Value) -> Event {
    Event {
        kind: kind.into(),
        data: json!({"payload":payload}),
        sequence: None,
    }
}

#[test]
fn reconciles_live_deltas_and_durable_message_without_duplication() {
    let mut translator = Translator::default();
    translator.accept(&event("ephemeral_event", json!({"type":"stream_event","event":{"type":"message_start","message":{"id":"msg1"}}})), false).unwrap();
    let delta = event(
        "ephemeral_event",
        json!({"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hé"}}}),
    );
    assert_eq!(
        translator.accept(&delta, false).unwrap(),
        vec![Update::Text("hé".into())]
    );
    let durable = event(
        "client_event",
        json!({"type":"assistant","uuid":"a1","message":{"id":"msg1","content":[{"type":"text","text":"héllo"}]}}),
    );
    assert_eq!(
        translator.accept(&durable, false).unwrap(),
        vec![Update::Text("llo".into())]
    );
    assert!(translator.accept(&durable, false).unwrap().is_empty());
}

#[test]
fn durable_only_transcript_replays_full_text() {
    let mut translator = Translator::default();
    let durable = event(
        "client_event",
        json!({"type":"assistant","uuid":"a1","message":{"id":"msg1","content":[{"type":"text","text":"hello"}]}}),
    );
    assert_eq!(
        translator.accept(&durable, true).unwrap(),
        vec![Update::Text("hello".into())]
    );
}

#[test]
fn text_with_no_message_start_waits_for_durable_recovery() {
    let mut translator = Translator::default();
    let delta = event(
        "ephemeral_event",
        json!({"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}}),
    );
    assert!(translator.accept(&delta, false).unwrap().is_empty());
}

#[test]
fn history_includes_user_but_live_echo_does_not_duplicate_prompt() {
    let message = event(
        "client_event",
        json!({"type":"user","uuid":"u1","message":{"content":"hi"}}),
    );
    assert!(
        Translator::default()
            .accept(&message, false)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        Translator::default().accept(&message, true).unwrap(),
        vec![Update::User("hi".into())]
    );
}

#[test]
fn tool_output_retains_call_identity_and_failure() {
    let message = event(
        "client_event",
        json!({"type":"user","uuid":"u1","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"denied","is_error":true}]}}),
    );
    assert_eq!(
        Translator::default().accept(&message, false).unwrap(),
        vec![Update::ToolResult {
            id: "t1".into(),
            output: json!("denied"),
            failed: true
        }]
    );
}

#[test]
fn truncated_replay_is_not_silently_accepted() {
    assert!(matches!(
        Translator::default().accept(&event("catch_up_truncated", json!({})), false),
        Err(Error::Recovery)
    ));
}
