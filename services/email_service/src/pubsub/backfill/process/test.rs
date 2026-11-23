use super::*;
use aws_sdk_sqs::types::{Message, MessageAttributeValue};
use opentelemetry::trace::{SpanId, Status, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use sqs_client::email::trace_context;
use tracing::instrument::WithSubscriber as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

/// A backfill message queued from `sender`, carrying its context as SQS does.
fn queued_from(sender: &tracing::Span) -> Message {
    let traceparent = sender
        .in_scope(trace_context::current)
        .expect("the sender has a trace");
    Message::builder()
        .message_id("job")
        .message_attributes(
            trace_context::ATTRIBUTE,
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(traceparent)
                .build()
                .unwrap(),
        )
        .build()
}

/// The exporter and subscriber of one test. The provider must outlive the test's
/// spans: dropping it shuts the exporter down.
fn capture() -> (
    InMemorySpanExporter,
    SdkTracerProvider,
    impl tracing::Subscriber + Send + Sync,
) {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("backfill-test")));
    (exporter, provider, subscriber)
}

#[tokio::test]
async fn a_backfill_job_runs_in_the_trace_that_queued_it() {
    let (exporter, _provider, subscriber) = capture();

    let sent_from = async {
        // Another test may have cached a "never" interest for the callsite.
        tracing::callsite::rebuild_interest_cache();
        let sender = tracing::info_span!(parent: None, "backfill.enqueue");
        let sent_from = sender.context().span().span_context().clone();
        let message = queued_from(&sender);
        drop(sender);
        in_job_span(&message, async {
            tracing::info_span!("email.backfill.step").in_scope(|| {});
            Ok(())
        })
        .await
        .unwrap();
        sent_from
    }
    .with_subscriber(subscriber)
    .await;

    let spans = exporter.get_finished_spans().unwrap();
    let span = |name: &str| {
        spans
            .iter()
            .find(|span| span.name == name)
            .unwrap_or_else(|| panic!("{name} was exported"))
    };
    let job = span("email.backfill.process");
    assert_eq!(job.span_context.trace_id(), sent_from.trace_id());
    assert_eq!(job.parent_span_id, sent_from.span_id());
    let step = span("email.backfill.step");
    assert_eq!(step.span_context.trace_id(), sent_from.trace_id());
    assert_eq!(step.parent_span_id, job.span_context.span_id());
    assert_ne!(step.parent_span_id, SpanId::INVALID);
}

#[tokio::test]
async fn an_untraced_failed_job_is_a_root_span_marked_failed() {
    let (exporter, _provider, subscriber) = capture();

    async {
        tracing::callsite::rebuild_interest_cache();
        let ambient = tracing::info_span!("unrelated");
        let message = Message::builder().message_id("job").build();
        in_job_span(&message, async { anyhow::bail!("job failed") })
            .instrument(ambient)
            .await
            .unwrap_err();
    }
    .with_subscriber(subscriber)
    .await;

    let spans = exporter.get_finished_spans().unwrap();
    let job = spans
        .iter()
        .find(|span| span.name == "email.backfill.process")
        .expect("the job span was exported");
    assert_eq!(job.parent_span_id, SpanId::INVALID);
    assert!(
        matches!(job.status, Status::Error { .. }),
        "{:?}",
        job.status
    );
}
