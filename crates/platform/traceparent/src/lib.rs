//! A span's W3C `traceparent` as one string, for hops that store a single
//! value instead of a header map: Postgres rows, `NOTIFY` payloads, SQS
//! message attributes. Work a request queues for a background loop or
//! another service stays in the request's trace. Without a global
//! propagator, or outside any span, nothing is carried.

#![deny(missing_docs)]

#[cfg(test)]
mod test;

use opentelemetry::trace::TraceContextExt as _;
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// The W3C header name, also the key a carried value is stored under.
pub const TRACEPARENT: &str = "traceparent";

/// The current span's `traceparent`, when it has a valid trace context.
pub fn current() -> Option<String> {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return None;
    }

    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    carrier.remove(TRACEPARENT)
}

/// Make `span` a child of the span named by `traceparent`. Missing or
/// malformed context leaves the span where it is.
pub fn adopt(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };

    let carrier = HashMap::from([(TRACEPARENT.to_owned(), traceparent.to_owned())]);
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &carrier)
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}
