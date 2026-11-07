use opentelemetry::trace::TraceFlags;

use std::collections::HashMap;

use super::{TRACEPARENT, parse_traceparent, traceparent_from_headers};

#[test]
fn parses_valid_traceparent() {
    let traceparent = parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        .expect("valid traceparent");

    assert_eq!(
        traceparent.trace_id().to_string(),
        "4bf92f3577b34da6a3ce929d0e0e4736"
    );
    assert_eq!(traceparent.span_id().to_string(), "00f067aa0ba902b7");
    assert_eq!(traceparent.trace_flags(), TraceFlags::SAMPLED);
}

#[test]
fn rejects_invalid_traceparent() {
    assert!(parse_traceparent("invalid").is_none());
}

#[test]
fn extracts_traceparent_from_hash_map() {
    let headers = HashMap::from([(
        TRACEPARENT.to_string(),
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_string(),
    )]);

    assert!(traceparent_from_headers(&headers).is_some());
}

#[test]
fn extracts_traceparent_from_http_headers() {
    let mut headers = http::HeaderMap::new();
    headers.insert(
        TRACEPARENT,
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
            .parse()
            .expect("valid header value"),
    );

    assert!(traceparent_from_headers(&headers).is_some());
}
