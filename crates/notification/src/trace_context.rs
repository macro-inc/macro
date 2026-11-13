//! W3C trace context carried on ingress queue messages, so the worker that
//! stores and delivers a notification links back to the request that sent it.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use opentelemetry::trace::TraceContextExt as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// Only these keys cross the queue; baggage is never forwarded.
const KEYS: [&str; 2] = ["traceparent", "tracestate"];

/// The current span's context, empty when there is none.
pub(crate) fn current() -> HashMap<String, String> {
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier);
    });
    carrier.retain(|key, _| KEYS.contains(&key.as_str()));
    carrier
}

/// Link `span` to the producer recorded in `carrier`, keeping the worker's
/// own parent. Missing or invalid context is ignored.
pub(crate) fn link(span: &tracing::Span, carrier: &HashMap<String, String>) {
    if carrier.is_empty() {
        return;
    }
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), carrier)
    });
    let producer = context.span().span_context().clone();
    if producer.is_valid() {
        span.add_link(producer);
    }
}
