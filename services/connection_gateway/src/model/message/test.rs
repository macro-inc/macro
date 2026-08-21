use super::{Message, TraceCarrier};

#[test]
fn envelope_without_trace_fields_remains_compatible() {
    let message: Message = serde_json::from_str(r#"{"type":"refresh","data":"{}"}"#).unwrap();

    assert_eq!(message.message_type, "refresh");
    assert_eq!(message.trace, TraceCarrier::default());
    assert_eq!(
        serde_json::to_value(message).unwrap(),
        serde_json::json!({"type": "refresh", "data": "{}"})
    );
}

#[test]
fn envelope_accepts_additive_w3c_trace_fields() {
    let message: Message = serde_json::from_value(serde_json::json!({
        "type": "refresh",
        "data": "{}",
        "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "tracestate": "vendor=value"
    }))
    .unwrap();

    assert_eq!(
        message.trace.traceparent.as_deref(),
        Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
    );
    assert_eq!(message.trace.tracestate.as_deref(), Some("vendor=value"));
}
