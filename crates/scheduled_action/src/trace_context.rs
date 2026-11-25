//! W3C trace context kept on rows, so work picked up later, on any replica,
//! stays in the trace that started it.

use opentelemetry::propagation::Extractor;
use opentelemetry::trace::TraceContextExt as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

#[cfg(test)]
mod test;
#[cfg(test)]
pub(crate) mod testing;

const TRACEPARENT: &str = "traceparent";

struct Single<'a>(&'a str);

impl Extractor for Single<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        (key == TRACEPARENT).then_some(self.0)
    }

    fn keys(&self) -> Vec<&str> {
        vec![TRACEPARENT]
    }
}

/// The current span's `traceparent`, when it is in a trace.
pub(crate) fn current() -> Option<String> {
    let mut headers = axum::http::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
        .get(TRACEPARENT)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// Make `span`, not yet entered, a child of the span `traceparent` names.
/// Missing or malformed context leaves it where it is.
pub(crate) fn adopt(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &Single(traceparent))
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}
