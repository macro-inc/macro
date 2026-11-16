//! W3C trace context carried on stored events, so processing joins the
//! webhook's trace.

use std::collections::HashMap;

use opentelemetry::global;
use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// The current span's `traceparent`; `None` when no tracing provider runs.
pub fn traceparent() -> Option<String> {
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier)
    });
    carrier.remove("traceparent")
}

/// Links `span` to the webhook span that stored the event. Applying runs
/// later and in batches, so it links rather than parents.
pub fn link(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let carrier = HashMap::from([("traceparent".to_owned(), traceparent.to_owned())]);
    let context = global::get_text_map_propagator(|propagator| propagator.extract(&carrier));
    let origin = context.span().span_context().clone();
    if origin.is_valid() {
        span.add_link(origin);
    }
}
