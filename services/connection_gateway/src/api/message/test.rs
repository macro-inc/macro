use super::*;

use opentelemetry::trace::{Status, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing::Instrument as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[tokio::test(flavor = "current_thread")]
async fn trace_send_messages_records_parent_fields_and_error_status() {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("test"))
            .with_error_events_to_status(true),
    );

    let _subscriber_guard = tracing::subscriber::set_default(subscriber);
    let handler_span = tracing::info_span!("batch_send_message_handler");
    let result = trace_send_messages("shared", 2, || async {
        async { Err::<(), _>("send failed") }
            .instrument(tracing::info_span!("send_message_to_entity"))
            .await
    })
    .instrument(handler_span)
    .await;

    assert_eq!(result, Err("send failed"));

    let spans = exporter
        .get_finished_spans()
        .expect("finished spans should be available");
    let handler_span = spans
        .iter()
        .find(|span| span.name == "batch_send_message_handler")
        .expect("handler span should be exported");
    let send_messages_span = spans
        .iter()
        .find(|span| span.name == "send_messages")
        .expect("send_messages span should be exported");
    let entity_span = spans
        .iter()
        .find(|span| span.name == "send_message_to_entity")
        .expect("entity span should be exported");

    assert_eq!(
        send_messages_span.parent_span_id,
        handler_span.span_context.span_id()
    );
    assert_eq!(
        entity_span.parent_span_id,
        send_messages_span.span_context.span_id()
    );
    assert!(matches!(send_messages_span.status, Status::Error { .. }));
    assert_span_attribute(send_messages_span, "batch_kind", "shared");
    assert_span_attribute(send_messages_span, "message_count", "2");
}

fn assert_span_attribute(span: &opentelemetry_sdk::trace::SpanData, key: &str, expected: &str) {
    let value = span
        .attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.to_string());

    assert_eq!(value.as_deref(), Some(expected));
}
