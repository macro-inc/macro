use super::*;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing_subscriber::layer::SubscriberExt as _;

fn trace_id(traceparent: &str) -> &str {
    traceparent
        .split('-')
        .nth(1)
        .expect("traceparent has a trace id")
}

#[test]
fn a_carried_traceparent_puts_the_adopting_span_in_the_same_trace() {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(InMemorySpanExporter::default())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("traceparent-test")));

    tracing::subscriber::with_default(subscriber, || {
        assert_eq!(current(), None);

        let request = tracing::info_span!(parent: None, "request");
        let carried = request
            .in_scope(current)
            .expect("request has a trace context");

        let worker = tracing::info_span!(parent: None, "worker");
        adopt(&worker, Some(&carried));
        let adopted = worker
            .in_scope(current)
            .expect("worker has a trace context");
        assert_eq!(trace_id(&adopted), trace_id(&carried));
        assert_ne!(adopted, carried);

        let untouched = tracing::info_span!(parent: None, "untouched");
        let before = untouched.in_scope(current);
        adopt(&untouched, Some("not-a-traceparent"));
        adopt(&untouched, None);
        assert_eq!(untouched.in_scope(current), before);
    });
}
