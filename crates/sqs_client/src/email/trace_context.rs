//! Optional W3C context for email backfill jobs, including retries and fan-out.

use opentelemetry::trace::TraceContextExt as _;
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// SQS string attribute carrying a W3C traceparent. Older workers ignore it.
pub const ATTRIBUTE: &str = "traceparent";

/// Capture only valid tracing context from the current operation.
pub fn current() -> Option<String> {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return None;
    }
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    carrier.remove(ATTRIBUTE)
}

/// Adopt persisted context before polling a publisher or consumer span.
/// Missing or malformed context leaves legacy jobs unaffected.
pub fn adopt(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let carrier = HashMap::from([(ATTRIBUTE.to_owned(), traceparent.to_owned())]);
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &carrier)
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}

pub(super) fn attribute() -> Option<aws_sdk_sqs::types::MessageAttributeValue> {
    current().and_then(|value| {
        aws_sdk_sqs::types::MessageAttributeValue::builder()
            .data_type("String")
            .string_value(value)
            .build()
            .ok()
    })
}
