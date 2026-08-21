use super::*;
use opentelemetry::trace::{SpanId, SpanKind, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use rdkafka::message::{OwnedMessage, Timestamp};
use std::sync::Once;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

fn install_trace_context_propagator() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    });
}

struct TestConsumerGroup;

impl GroupName for TestConsumerGroup {
    const GROUP_NAME: &'static str = "consumer-group";
}

#[test]
fn producer_config_uses_brokers_and_message_timeout() {
    let config = producer_config("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("message.timeout.ms"), Some(MESSAGE_TIMEOUT_MS));
    assert_eq!(config.get("enable.auto.commit"), None);
}

#[test]
fn grouped_config_uses_named_group_manual_commits_and_earliest_offsets() {
    let config = grouped_config::<TestConsumerGroup>("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
}

#[test]
fn ungrouped_config_uses_unique_internal_groups_without_offset_storage() {
    let first = ungrouped_config("broker:9092");
    let second = ungrouped_config("broker:9092");
    let first_group = first.get("group.id").unwrap();
    let second_group = second.get("group.id").unwrap();

    assert!(first_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert!(second_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert_ne!(first_group, second_group);
    assert_eq!(first.get("enable.auto.commit"), Some("false"));
    assert_eq!(first.get("enable.auto.offset.store"), Some("false"));
    assert_eq!(first.get("auto.offset.reset"), None);
}

#[test]
fn ungrouped_initial_offsets_are_explicit() {
    assert_eq!(InitialOffset::Earliest.as_kafka_offset(), Offset::Beginning);
    assert_eq!(InitialOffset::Latest.as_kafka_offset(), Offset::End);
}

#[test]
fn current_trace_context_is_injected_and_extracted_from_kafka_headers() {
    install_trace_context_propagator();
    let provider = SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    tracing::subscriber::with_default(subscriber, || {
        let producer = tracing::info_span!("producer");
        let _guard = producer.enter();
        let producer_context = producer.context();
        let producer_span_context = producer_context.span().span_context().clone();
        let headers = current_trace_headers();

        assert!(headers.iter().any(|header| header.key == "traceparent"));

        let message = OwnedMessage::new(
            None,
            None,
            "macro.test".to_owned(),
            Timestamp::NotAvailable,
            2,
            42,
            Some(headers),
        );
        let extracted = remote_trace_context(&message);
        let extracted = extracted.span().span_context().clone();

        assert_eq!(extracted.trace_id(), producer_span_context.trace_id());
        assert_eq!(extracted.span_id(), producer_span_context.span_id());
        assert!(extracted.is_remote());
    });
}

#[test]
fn consumer_span_adopts_propagated_parent_and_records_transport_fields() {
    install_trace_context_propagator();
    let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    let producer_span_id = tracing::subscriber::with_default(subscriber, || {
        let producer = tracing::info_span!("producer");
        let guard = producer.enter();
        let producer_span_id = producer.context().span().span_context().span_id();
        let headers = current_trace_headers();
        drop(guard);

        let message = OwnedMessage::new(
            None,
            None,
            "macro.test".to_owned(),
            Timestamp::NotAvailable,
            2,
            42,
            Some(headers),
        );
        let consumer = consumer_span(&message, "test-consumer");
        let _consumer_guard = consumer.enter();
        tracing::info!("handled message");
        producer_span_id
    });
    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let consumer = spans
        .iter()
        .find(|span| span.name == "kafka.process")
        .expect("consumer span");

    assert_eq!(consumer.parent_span_id, producer_span_id);
    assert_ne!(consumer.parent_span_id, SpanId::INVALID);
    assert_eq!(consumer.span_kind, SpanKind::Consumer);
    let attribute = |key: &str| {
        consumer
            .attributes
            .iter()
            .find(|attribute| attribute.key.as_str() == key)
            .map(|attribute| attribute.value.to_string())
    };
    assert_eq!(attribute("messaging.system").as_deref(), Some("kafka"));
    assert_eq!(
        attribute("messaging.operation.name").as_deref(),
        Some("process")
    );
    assert_eq!(
        attribute("messaging.consumer.group.name").as_deref(),
        Some("test-consumer")
    );
    assert_eq!(
        attribute("messaging.destination.name").as_deref(),
        Some("macro.test")
    );
    assert_eq!(
        attribute("messaging.destination.partition.id").as_deref(),
        Some("2")
    );
    assert_eq!(attribute("messaging.kafka.offset").as_deref(), Some("42"));
}

#[test]
fn missing_trace_headers_leave_consumer_span_as_a_root() {
    install_trace_context_propagator();
    let message = OwnedMessage::new(
        None,
        None,
        "macro.test".to_owned(),
        Timestamp::NotAvailable,
        0,
        0,
        None,
    );

    let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    tracing::subscriber::with_default(subscriber, || {
        let ambient = tracing::info_span!("ambient");
        let _ambient_guard = ambient.enter();
        let consumer = consumer_span(&message, "test-consumer");
        let _consumer_guard = consumer.enter();
    });
    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let consumer = spans
        .iter()
        .find(|span| span.name == "kafka.process")
        .expect("consumer span");

    assert_eq!(consumer.parent_span_id, SpanId::INVALID);
}
