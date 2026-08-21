use super::{MessageWithConnection, dispatch_with_trace, publish_with_trace};
use crate::{
    api::send_outgoing_message,
    model::message::{Message, OutgoingMessage, TraceCarrier},
};
use futures::{SinkExt as _, StreamExt as _, channel::mpsc};
use opentelemetry::trace::{Status, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use redis::{FromRedisValue as _, Value};
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[test]
fn redis_round_trip_preserves_trace_carrier() {
    let original = MessageWithConnection {
        message: Message {
            message_type: "refresh".into(),
            data: "{}".into(),
            trace: TraceCarrier {
                traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".into()),
                tracestate: Some("vendor=value".into()),
            },
        },
        connection_id: "connection-1".into(),
    };
    let encoded = serde_json::to_vec(&original).unwrap();
    let decoded = MessageWithConnection::from_redis_value(Value::BulkString(encoded)).unwrap();

    assert_eq!(decoded.connection_id, original.connection_id);
    assert_eq!(decoded.message.message_type, original.message.message_type);
    assert_eq!(decoded.message.data, original.message.data);
    assert_eq!(decoded.message.trace, original.message.trace);
}

#[tokio::test(flavor = "current_thread")]
async fn redis_boundary_spans_mark_failures_as_errors() {
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

    let failed_publish: anyhow::Result<()> = publish_with_trace(
        MessageWithConnection {
            message: Message::new("refresh".into(), "{}".into()),
            connection_id: "connection-1".into(),
        },
        |_| async { anyhow::bail!("redis publish failed") },
    )
    .await;
    assert!(failed_publish.is_err());

    let producer = tracing::info_span!("producer");
    let message = {
        let _guard = producer.enter();
        Message::new("refresh".into(), "{}".into())
    };
    drop(producer);
    let failed_dispatch: anyhow::Result<()> = dispatch_with_trace(
        MessageWithConnection {
            message,
            connection_id: "connection-1".into(),
        },
        |_| async { anyhow::bail!("redis dispatch failed") },
    )
    .await;
    assert!(failed_dispatch.is_err());

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    for name in [
        "connection_gateway.redis_publish",
        "connection_gateway.redis_dispatch",
    ] {
        let span = spans
            .iter()
            .find(|span| span.name == name)
            .unwrap_or_else(|| panic!("missing {name} span"));
        assert!(matches!(span.status, Status::Error { .. }));
    }
}

#[tokio::test(flavor = "current_thread")]
async fn redis_publish_and_dispatch_form_the_remote_parent_chain() {
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

    let source = tracing::info_span!("redis_source");
    let source_span_id = source.context().span().span_context().span_id();
    let published = publish_with_trace(
        MessageWithConnection {
            message: Message::new("refresh".into(), "{}".into()),
            connection_id: "connection-1".into(),
        },
        |message| async move { Ok::<_, anyhow::Error>(message) },
    )
    .instrument(source.clone())
    .await
    .unwrap();
    drop(source);

    let dispatched = dispatch_with_trace(published, |message| async move {
        Ok::<_, anyhow::Error>(message.message)
    })
    .await
    .unwrap();

    let (mut sink, mut receiver) = mpsc::channel(1);
    send_outgoing_message(&mut sink, OutgoingMessage::Message(dispatched))
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
    let publish = spans
        .iter()
        .find(|span| span.name == "connection_gateway.redis_publish")
        .expect("redis publish span");
    let dispatch = spans
        .iter()
        .find(|span| span.name == "connection_gateway.redis_dispatch")
        .expect("redis dispatch span");
    let websocket_send = spans
        .iter()
        .find(|span| span.name == "connection_gateway.websocket_send")
        .expect("websocket send span");
    assert_eq!(publish.parent_span_id, source_span_id);
    assert_eq!(dispatch.parent_span_id, publish.span_context.span_id());
    assert_eq!(
        websocket_send.parent_span_id,
        dispatch.span_context.span_id()
    );

    let carried = envelope.remote_trace_context().expect("send trace carrier");
    assert_eq!(
        carried.span().span_context().span_id(),
        websocket_send.span_context.span_id()
    );
}
