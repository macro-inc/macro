use super::send_outgoing_message;
use crate::model::message::{Message, OutgoingMessage};
use futures::{SinkExt as _, StreamExt as _, channel::mpsc};
use opentelemetry::trace::{SpanId, Status, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[tokio::test(flavor = "current_thread")]
async fn websocket_send_uses_carried_parent_and_emits_its_own_carrier() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);

    let source = tracing::info_span!("source");
    let source_span_id = source.context().span().span_context().span_id();
    let message = {
        let _guard = source.enter();
        Message::new("refresh".into(), "{}".into())
    };
    drop(source);

    let (mut sink, mut receiver) = mpsc::channel(1);
    send_outgoing_message(&mut sink, OutgoingMessage::Message(message))
        .await
        .unwrap();
    sink.flush().await.unwrap();
    let wire_message = receiver.next().await.unwrap();
    let axum::extract::ws::Message::Text(text) = wire_message else {
        panic!("expected text websocket message");
    };
    let envelope: Message = serde_json::from_str(&text).unwrap();

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let send = spans
        .iter()
        .find(|span| span.name == "connection_gateway.websocket_send")
        .expect("websocket send span");
    assert_ne!(source_span_id, SpanId::INVALID);
    assert_eq!(send.parent_span_id, source_span_id);

    let carried = envelope.remote_trace_context().expect("send trace carrier");
    let carried_span = carried.span();
    assert_eq!(
        carried_span.span_context().trace_id(),
        send.span_context.trace_id()
    );
    assert_eq!(
        carried_span.span_context().span_id(),
        send.span_context.span_id()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn websocket_send_marks_sink_failures_as_errors() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);

    let (mut sink, receiver) = mpsc::channel(1);
    drop(receiver);
    let result = send_outgoing_message(
        &mut sink,
        OutgoingMessage::Message(Message::new("refresh".into(), "{}".into())),
    )
    .await;
    assert!(result.is_err());

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let send = spans
        .iter()
        .find(|span| span.name == "connection_gateway.websocket_send")
        .expect("websocket send span");
    assert!(matches!(send.status, Status::Error { .. }));
}
