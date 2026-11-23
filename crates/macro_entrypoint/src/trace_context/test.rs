use super::*;

use opentelemetry::trace::TraceContextExt as _;
use std::collections::HashMap;

const TRACE_ID: &str = "5b8aa5a2d2c872e8321cf37308d69df2";
const SPAN_ID: &str = "051581bf3cb55c13";

fn extract(traceparent: &str) -> opentelemetry::trace::SpanContext {
    let headers = HashMap::from([(TRACEPARENT.to_owned(), traceparent.to_owned())]);
    TraceContextLevel2::default()
        .extract(&headers)
        .span()
        .span_context()
        .clone()
}

#[test]
fn a_sampled_traceparent_with_the_random_flag_continues_the_trace() {
    // What otel-cf-workers sends for a sampled root: sampled | random.
    let context = extract(&format!("00-{TRACE_ID}-{SPAN_ID}-03"));

    assert!(context.is_valid() && context.is_remote());
    assert_eq!(context.trace_id().to_string(), TRACE_ID);
    assert_eq!(context.span_id().to_string(), SPAN_ID);
    assert!(context.is_sampled());

    // The stock propagator refuses it.
    let headers = HashMap::from([(
        TRACEPARENT.to_owned(),
        format!("00-{TRACE_ID}-{SPAN_ID}-03"),
    )]);
    assert!(
        !TraceContextPropagator::new()
            .extract(&headers)
            .span()
            .span_context()
            .is_valid()
    );
}

#[test]
fn level_1_flags_read_as_before() {
    let sampled = extract(&format!("00-{TRACE_ID}-{SPAN_ID}-01"));
    assert!(sampled.is_valid() && sampled.is_sampled());

    let unsampled = extract(&format!("00-{TRACE_ID}-{SPAN_ID}-00"));
    assert!(unsampled.is_valid() && !unsampled.is_sampled());

    // Random alone, unsampled: still unsampled.
    let random = extract(&format!("00-{TRACE_ID}-{SPAN_ID}-02"));
    assert!(random.is_valid() && !random.is_sampled());
}

#[test]
fn malformed_traceparents_are_still_refused() {
    for traceparent in [
        format!("00-{TRACE_ID}-{SPAN_ID}-zz"),
        format!("00-{TRACE_ID}-{SPAN_ID}-0301"),
        format!("00-{TRACE_ID}-{SPAN_ID}-+3"),
        // The SDK alone reads these as sampled and not sampled.
        format!("00-{TRACE_ID}-{SPAN_ID}-+1"),
        format!("00-{TRACE_ID}-{SPAN_ID}-+0"),
        format!("00-{TRACE_ID}-{SPAN_ID}-0A"),
        format!("00-{TRACE_ID}-{SPAN_ID}-0B"),
        // Flags of the wrong length, which the SDK alone reads as sampled.
        format!("00-{TRACE_ID}-{SPAN_ID}-1"),
        format!("00-{TRACE_ID}-{SPAN_ID}-001"),
        format!("00-{TRACE_ID}-{SPAN_ID}-01-"),
        format!("00-00000000000000000000000000000000-{SPAN_ID}-03"),
        format!("00-{TRACE_ID}-0000000000000000-03"),
        "03".to_owned(),
    ] {
        assert!(!extract(&traceparent).is_valid(), "{traceparent}");
    }
}

#[test]
fn injection_is_the_stock_propagators() {
    let context = opentelemetry::Context::new().with_remote_span_context(
        opentelemetry::trace::SpanContext::new(
            opentelemetry::trace::TraceId::from_hex(TRACE_ID).unwrap(),
            opentelemetry::trace::SpanId::from_hex(SPAN_ID).unwrap(),
            opentelemetry::trace::TraceFlags::SAMPLED,
            true,
            Default::default(),
        ),
    );
    let mut headers = HashMap::new();
    TraceContextLevel2::default().inject_context(&context, &mut headers);

    assert_eq!(
        headers.get(TRACEPARENT).map(String::as_str),
        Some(format!("00-{TRACE_ID}-{SPAN_ID}-01").as_str())
    );
}

#[test]
fn a_flag_the_sdk_reads_leniently_is_refused() {
    let traceparent = format!("00-{TRACE_ID}-{SPAN_ID}-+1");
    let headers = HashMap::from([(TRACEPARENT.to_owned(), traceparent.clone())]);
    assert!(
        TraceContextPropagator::new()
            .extract(&headers)
            .span()
            .span_context()
            .is_sampled(),
        "the stock propagator takes +1 as sampled"
    );
    assert!(!extract(&traceparent).is_valid());
}

#[test]
fn flags_of_the_wrong_length_are_refused() {
    for traceparent in [
        format!("00-{TRACE_ID}-{SPAN_ID}-1"),
        format!("00-{TRACE_ID}-{SPAN_ID}-001"),
    ] {
        let headers = HashMap::from([(TRACEPARENT.to_owned(), traceparent.clone())]);
        assert!(
            TraceContextPropagator::new()
                .extract(&headers)
                .span()
                .span_context()
                .is_sampled(),
            "the stock propagator takes {traceparent} as sampled"
        );
        assert!(!extract(&traceparent).is_valid(), "{traceparent}");
    }
}
