use super::dispatch_local_message;
use crate::{
    api::send_outgoing_message,
    model::message::{Message, OutgoingMessage},
};
use futures::{SinkExt as _, StreamExt as _, channel::mpsc};
use opentelemetry::trace::{Status, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[tokio::test(flavor = "current_thread")]
async fn local_dispatch_is_the_websocket_send_parent() {
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

    let source = tracing::info_span!("local_source");
    let source_span_id = source.context().span().span_context().span_id();
    let message = dispatch_local_message(
        Message::new("refresh".into(), "{}".into()),
        |message| async move { Ok::<_, anyhow::Error>(message) },
    )
    .instrument(source.clone())
    .await
    .unwrap();
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
    let local_dispatch = spans
        .iter()
        .find(|span| span.name == "connection_gateway.local_dispatch")
        .expect("local dispatch span");
    let websocket_send = spans
        .iter()
        .find(|span| span.name == "connection_gateway.websocket_send")
        .expect("websocket send span");
    assert_eq!(local_dispatch.parent_span_id, source_span_id);
    assert_eq!(
        websocket_send.parent_span_id,
        local_dispatch.span_context.span_id()
    );

    let carried = envelope.remote_trace_context().expect("send trace carrier");
    assert_eq!(
        carried.span().span_context().span_id(),
        websocket_send.span_context.span_id()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn local_dispatch_marks_failures_as_errors() {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);

    let result: anyhow::Result<()> =
        dispatch_local_message(Message::new("refresh".into(), "{}".into()), |_| async {
            anyhow::bail!("local dispatch failed")
        })
        .await;
    assert!(result.is_err());

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let local_dispatch = spans
        .iter()
        .find(|span| span.name == "connection_gateway.local_dispatch")
        .expect("local dispatch span");
    assert!(matches!(local_dispatch.status, Status::Error { .. }));
}
