use super::*;
use serde_json::json;

#[test]
fn documented_events_decode() {
    let status = CursorEvent::from_wire("status", json!({"runId": "run-1", "status": "RUNNING"}));
    assert_eq!(
        status,
        CursorEvent::Status {
            run_id: CursorRunId::new("run-1"),
            status: RunStatus::Running,
        }
    );

    let result = CursorEvent::from_wire(
        "result",
        json!({"runId": "run-1", "status": "FINISHED", "text": "done", "durationMs": 12}),
    );
    assert_eq!(
        result,
        CursorEvent::Result {
            run_id: CursorRunId::new("run-1"),
            status: RunStatus::Finished,
            text: Some("done".to_owned()),
            duration_ms: Some(12),
        }
    );

    assert_eq!(
        CursorEvent::from_wire("heartbeat", json!({})),
        CursorEvent::Heartbeat
    );
    assert_eq!(CursorEvent::from_wire("done", json!({})), CursorEvent::Done);
}

#[test]
fn interaction_subtypes_decode() {
    let started = CursorEvent::from_wire(
        "interaction_update",
        json!({"type": "tool-call-started", "callId": "c1", "toolCall": {"type": "shell"}}),
    );
    assert_eq!(
        started,
        CursorEvent::Interaction(InteractionUpdate::ToolCallStarted {
            call_id: "c1".to_owned(),
            tool_type: Some("shell".to_owned()),
        })
    );

    let tokens = CursorEvent::from_wire(
        "interaction_update",
        json!({"type": "token-delta", "tokens": 7}),
    );
    assert_eq!(
        tokens,
        CursorEvent::Interaction(InteractionUpdate::TokenDelta { tokens: 7 })
    );

    // The duplicating text subtypes land in Other, which the translation drops.
    let delta = CursorEvent::from_wire(
        "interaction_update",
        json!({"type": "text-delta", "text": "hi"}),
    );
    assert_eq!(
        delta,
        CursorEvent::Interaction(InteractionUpdate::Other {
            kind: "text-delta".to_owned()
        })
    );
}

/// Shape drift degrades to Unknown instead of killing a stream that already
/// cost a run.
#[test]
fn malformed_payloads_degrade_to_unknown() {
    let event = CursorEvent::from_wire("status", json!({"unexpected": true}));
    assert!(matches!(event, CursorEvent::Unknown { .. }));
    let event = CursorEvent::from_wire("brand_new_event", json!({}));
    assert!(matches!(event, CursorEvent::Unknown { .. }));
}

/// `truncated` is an object on the wire, not a bool.
///
/// Recorded in `fixtures/real/list_and_delete.sse` as `{"result": true}`.
/// Typing it as `bool` made the whole `tool_call` event fail to deserialize
/// and degrade to [`CursorEvent::Unknown`] — so a real tool call vanished from
/// the client entirely over a metadata field nothing reads.
#[test]
fn a_truncated_object_still_decodes_the_tool_call() {
    let event = CursorEvent::from_wire(
        "tool_call",
        serde_json::json!({
            "callId": "call-1",
            "name": "read_file",
            "status": "completed",
            "truncated": { "result": true },
        }),
    );
    let CursorEvent::ToolCall(call) = event else {
        panic!("a tool_call with a truncation object must still decode: {event:?}");
    };
    assert_eq!(call.name, "read_file");
    assert!(call.truncated.result, "the result half was truncated");
    assert!(!call.truncated.args);
}

/// A truncation shape this crate has not seen must not cost the tool call.
///
/// The field is metadata the translation never reads; losing an entire call
/// because its shape drifted is far worse than losing the flag.
#[test]
fn an_unexpected_truncation_shape_costs_only_the_flag() {
    for shape in [
        serde_json::json!(true),
        serde_json::json!("result"),
        serde_json::json!({ "somethingNew": true }),
    ] {
        let event = CursorEvent::from_wire(
            "tool_call",
            serde_json::json!({
                "callId": "call-1",
                "name": "read_file",
                "truncated": shape,
            }),
        );
        let CursorEvent::ToolCall(call) = event else {
            panic!("an unknown truncation shape must not fail the call: {event:?}");
        };
        assert!(!call.truncated.result);
        assert!(!call.truncated.args);
    }
}
