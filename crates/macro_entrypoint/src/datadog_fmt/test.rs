use opentelemetry::trace::{SpanContext, SpanId, TraceFlags, TraceId, TraceState};

use super::insert_trace_fields;

#[test]
fn writes_datadog_and_w3c_ids() {
    let sc = SpanContext::new(
        TraceId::from_hex("4bf92f3577b34da6a3ce929d0e0e4736").unwrap(),
        SpanId::from_hex("00f067aa0ba902b7").unwrap(),
        TraceFlags::SAMPLED,
        false,
        TraceState::default(),
    );
    let mut obj = serde_json::Map::new();
    insert_trace_fields(&mut obj, &sc);

    assert_eq!(
        obj["dd.trace_id"],
        u64::from_str_radix("a3ce929d0e0e4736", 16)
            .unwrap()
            .to_string()
    );
    assert_eq!(
        obj["dd.span_id"],
        u64::from_str_radix("00f067aa0ba902b7", 16)
            .unwrap()
            .to_string()
    );
    assert_eq!(obj["otel.trace_id"], "4bf92f3577b34da6a3ce929d0e0e4736");
    assert_eq!(obj["otel.span_id"], "00f067aa0ba902b7");

    // The observability ingest finds the IDs in the compact line by these
    // exact strings.
    let line = serde_json::to_string(&obj).unwrap();
    assert!(
        line.contains(r#""otel.trace_id":"4bf92f3577b34da6a3ce929d0e0e4736""#),
        "{line}"
    );
    assert!(
        line.contains(r#""otel.span_id":"00f067aa0ba902b7""#),
        "{line}"
    );
}

#[test]
fn writes_nothing_without_a_span() {
    let mut obj = serde_json::Map::new();
    insert_trace_fields(&mut obj, &SpanContext::empty_context());
    assert!(obj.is_empty());
}
