use http::{HeaderMap, Request};
use opentelemetry::global;
use opentelemetry::trace::TraceContextExt as _;
use opentelemetry_http::HeaderInjector;
use tower_http::{
    classify::{ServerErrorsAsFailures, SharedClassifier},
    trace::{MakeSpan, TraceLayer},
};
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// Inject the current span's W3C trace context into outbound HTTP headers.
pub fn inject_trace_headers(headers: &mut HeaderMap) {
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&Span::current().context(), &mut HeaderInjector(headers));
    });
}

/// Build a request tracing layer that adopts an inbound W3C `traceparent`.
pub fn http_trace_layer() -> TraceLayer<SharedClassifier<ServerErrorsAsFailures>, RequestSpan> {
    TraceLayer::new_for_http().make_span_with(RequestSpan)
}

/// Creates one span for each inbound HTTP request.
#[derive(Clone, Copy)]
pub struct RequestSpan;

impl<B> MakeSpan<B> for RequestSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let span = tracing::info_span!("http.request", http.request.method = %request.method());
        let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&opentelemetry_http::HeaderExtractor(request.headers()))
        });
        if parent.span().span_context().is_valid() {
            let _ = span.set_parent(parent);
        }
        span
    }
}

#[cfg(test)]
mod test;
