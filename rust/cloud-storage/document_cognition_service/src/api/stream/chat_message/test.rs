use super::*;

fn text(s: &str) -> AssistantMessagePart {
    AssistantMessagePart::Text { text: s.into() }
}
fn call(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCall {
        name: "t".into(),
        json: serde_json::json!({}),
        id: id.into(),
    }
}
fn resp(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCallResponseJson {
        name: "t".into(),
        json: serde_json::json!({}),
        id: id.into(),
    }
}
fn cancelled_err(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCallErr {
        name: "t".into(),
        id: id.into(),
        description: "cancelled".to_string(),
    }
}

#[test]
fn noop_when_no_tool_calls() {
    let parts = vec![text("a"), text("b")];
    assert_eq!(resolve_pending_tool_calls(parts.clone()), parts);
}

#[test]
fn noop_when_all_tool_calls_resolved() {
    let parts = vec![text("a"), call("1"), resp("1"), text("b")];
    assert_eq!(resolve_pending_tool_calls(parts.clone()), parts);
}

#[test]
fn inserts_cancelled_err_after_trailing_unmatched_call() {
    let parts = vec![text("a"), call("1")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(out, vec![text("a"), call("1"), cancelled_err("1")]);
}

#[test]
fn inserts_cancelled_err_immediately_after_unmatched_call() {
    let parts = vec![text("a"), call("1"), text("b")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![text("a"), call("1"), cancelled_err("1"), text("b")]
    );
}

#[test]
fn leaves_resolved_calls_alone_resolves_pending_ones() {
    let parts = vec![
        text("a"),
        call("1"),
        resp("1"),
        text("b"),
        call("2"),
        text("c"),
    ];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![
            text("a"),
            call("1"),
            resp("1"),
            text("b"),
            call("2"),
            cancelled_err("2"),
            text("c"),
        ]
    );
}

#[test]
fn resolves_multiple_unmatched_calls() {
    let parts = vec![call("1"), text("x"), call("2")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![
            call("1"),
            cancelled_err("1"),
            text("x"),
            call("2"),
            cancelled_err("2"),
        ]
    );
}

#[test]
fn empty_input_stays_empty() {
    assert!(resolve_pending_tool_calls(vec![]).is_empty());
}
