//! W3C trace context across the move hop (a TCP stream, not HTTP): the
//! source puts its span's `traceparent` in the request line, the target
//! makes it the parent of its peer span.

use std::collections::HashMap;

use opentelemetry::global;
use opentelemetry::trace::TraceContextExt as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// The current span's `traceparent`, absent without a tracing provider.
pub(super) fn traceparent() -> Option<String> {
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier);
    });
    carrier.remove("traceparent")
}

/// Make `traceparent` the parent of `span`, before `span` is entered.
pub(super) fn join(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let carrier = HashMap::from([("traceparent".to_owned(), traceparent.to_owned())]);
    let parent = global::get_text_map_propagator(|propagator| propagator.extract(&carrier));
    if parent.span().span_context().is_valid() {
        let _ = span.set_parent(parent);
    }
}
