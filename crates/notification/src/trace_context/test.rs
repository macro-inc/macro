use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

use super::{current, link};

#[test]
fn the_worker_span_links_to_the_sending_span() {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);

    let send = tracing::info_span!(parent: None, "notification.send_manual");
    let sent_from = send.context().span().span_context().clone();
    let carrier = send.in_scope(current);
    assert!(carrier.contains_key("traceparent"));
    assert!(
        carrier
            .keys()
            .all(|key| key == "traceparent" || key == "tracestate")
    );

    let wire = serde_json::to_string(&carrier).unwrap();
    let received = serde_json::from_str(&wire).unwrap();
    let process = tracing::info_span!(parent: None, "notification.ingress.process");
    link(&process, &received);
    drop(process);
    drop(send);

    provider.force_flush().unwrap();
    let spans = exporter.get_finished_spans().unwrap();
    let process = spans
        .iter()
        .find(|span| span.name == "notification.ingress.process")
        .unwrap();
    assert_eq!(process.links.links.len(), 1);
    let linked = &process.links.links[0].span_context;
    assert_eq!(linked.trace_id(), sent_from.trace_id());
    assert_eq!(linked.span_id(), sent_from.span_id());
    assert_ne!(process.span_context.trace_id(), sent_from.trace_id());
}

#[test]
fn a_message_without_context_is_left_unlinked() {
    let span = tracing::Span::none();
    link(&span, &Default::default());
    assert!(current().is_empty());
}
