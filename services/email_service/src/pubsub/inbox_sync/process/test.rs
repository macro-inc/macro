use super::*;
use aws_sdk_sqs::types::{Message, MessageAttributeValue};
use opentelemetry::trace::{SpanId, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use sqs_client::email::trace_context;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[test]
fn a_notification_is_processed_in_the_trace_that_queued_it() {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("inbox-sync-test")));
    let _guard = tracing::subscriber::set_default(subscriber);
    // Another test may have cached a "never" interest for the callsite.
    tracing::callsite::rebuild_interest_cache();

    let push = tracing::info_span!(parent: None, "gmail.push");
    let sent_from = push.context().span().span_context().clone();
    let traceparent = push.in_scope(trace_context::current).unwrap();
    drop(push);
    let queued = Message::builder()
        .message_id("queued")
        .message_attributes(
            trace_context::ATTRIBUTE,
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(traceparent)
                .build()
                .unwrap(),
        )
        .build();
    drop(delivery_span(&queued));
    drop(delivery_span(
        &Message::builder().message_id("legacy").build(),
    ));

    provider.force_flush().unwrap();
    let spans = exporter.get_finished_spans().unwrap();
    let delivery = |id: &str| {
        spans
            .iter()
            .find(|span| {
                span.name == "email.inbox_sync.process"
                    && span
                        .attributes
                        .iter()
                        .any(|kv| kv.key.as_str() == "message_id" && kv.value.as_str() == id)
            })
            .unwrap()
    };
    let queued = delivery("queued");
    assert_eq!(queued.span_context.trace_id(), sent_from.trace_id());
    assert_eq!(queued.parent_span_id, sent_from.span_id());
    assert_eq!(delivery("legacy").parent_span_id, SpanId::INVALID);
}
