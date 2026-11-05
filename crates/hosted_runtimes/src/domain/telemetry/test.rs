use super::*;
use opentelemetry::trace::TracerProvider;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing_subscriber::prelude::*;

#[test]
fn durable_work_adopts_parent_before_entering_and_running_callbacks_link() {
    global::set_text_map_propagator(opentelemetry_sdk::propagation::TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let parent = "00-11111111111111111111111111111111-2222222222222222-01";
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!(
            "durable.work",
            computer_id = "00000000-0000-4000-8000-000000000001",
            otel.status_code = tracing::field::Empty
        );
        attach(&span, Some(parent));
        let _entered = span.enter();
        assert!(
            traceparent()
                .expect("context is injected")
                .starts_with("00-11111111111111111111111111111111-")
        );
        effect_failed("create");
        let callback = tracing::info_span!("callback");
        let _entered_callback = callback.enter();
        resume(Some(
            "00-33333333333333333333333333333333-4444444444444444-01",
        ));
    });
    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let work = spans
        .iter()
        .find(|span| span.name == "durable.work")
        .expect("work span");
    assert_eq!(
        work.span_context.trace_id().to_string(),
        "11111111111111111111111111111111"
    );
    assert_eq!(work.parent_span_id.to_string(), "2222222222222222");
    assert!(matches!(
        work.status,
        opentelemetry::trace::Status::Error { .. }
    ));
    let callback = spans
        .iter()
        .find(|span| span.name == "callback")
        .expect("callback span");
    assert_eq!(callback.links.links.len(), 1);
    assert_eq!(
        callback.links.links[0].span_context.trace_id().to_string(),
        "33333333333333333333333333333333"
    );
}
