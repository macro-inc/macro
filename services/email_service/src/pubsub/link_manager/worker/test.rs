use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

#[tokio::test(start_paused = true)]
async fn renews_visibility_while_work_outlasts_the_timeout() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(150)).await;
            "purged"
        },
    )
    .await;

    assert_eq!(output, "purged");
    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn failed_renewals_do_not_stop_the_work_or_later_renewals() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            if renewals.fetch_add(1, Ordering::SeqCst) == 0 {
                anyhow::bail!("throttled");
            }
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(150)).await;
            "purged"
        },
    )
    .await;

    assert_eq!(output, "purged");
    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn quick_work_does_not_renew() {
    let renewals = AtomicU32::new(0);

    while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {},
    )
    .await;

    assert_eq!(renewals.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn failed_work_stops_renewing_so_the_message_is_redelivered() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(90)).await;
            Err::<(), _>(anyhow::anyhow!("purge batch failed"))
        },
    )
    .await;
    tokio::time::advance(Duration::from_secs(600)).await;

    assert!(output.is_err());
    assert_eq!(renewals.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_crashed_worker_stops_renewing() {
    let renewals = Arc::new(AtomicU32::new(0));

    let worker = tokio::spawn({
        let renewals = renewals.clone();
        async move {
            while_renewing_visibility(
                move || {
                    let renewals = renewals.clone();
                    async move {
                        renewals.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                },
                async {
                    tokio::time::sleep(Duration::from_secs(150)).await;
                    panic!("worker crashed mid-purge");
                },
            )
            .await
        }
    });

    assert!(worker.await.expect_err("the worker panicked").is_panic());
    tokio::time::advance(Duration::from_secs(600)).await;

    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}

/// The daily removal window is measured from these fields: which lane carried a
/// removal and how long it waited there.
#[test]
fn a_delivery_span_records_its_lane_kind_and_queue_wait() {
    use aws_sdk_sqs::types::{Message, MessageSystemAttributeName};
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use std::time::UNIX_EPOCH;
    use tracing_subscriber::layer::SubscriberExt as _;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("link-manager-test")));
    let message = Message::builder()
        .message_id("delivery")
        .body(
            r#"{"operation":"DeleteLink","link_id":"01a1fc80-0000-7000-8000-000000000001","deletion_reason":"ManuallyDisabled"}"#,
        )
        .attributes(MessageSystemAttributeName::SentTimestamp, "1700000000000")
        .build();
    let now = UNIX_EPOCH + Duration::from_millis(1_700_000_042_000);

    let decoded = tracing::subscriber::with_default(subscriber, || {
        // Another test may have cached a "never" interest for the callsite.
        tracing::callsite::rebuild_interest_cache();
        let (span, decoded) = delivery_span(LinkManagerLane::Interactive, &message, now);
        drop(span);
        decoded
    });

    assert!(matches!(decoded, Ok(LinkManagerMessage::DeleteLink { .. })));
    let spans = exporter.get_finished_spans().unwrap();
    let span = spans
        .iter()
        .find(|span| span.name == "email.link_manager.message")
        .expect("delivery span exported");
    let field = |key: &str| {
        span.attributes
            .iter()
            .find(|attribute| attribute.key.as_str() == key)
            .map(|attribute| attribute.value.clone())
    };
    assert_eq!(
        field("lane"),
        Some(opentelemetry::Value::from("interactive"))
    );
    assert_eq!(
        field("kind"),
        Some(opentelemetry::Value::from("DeleteLink"))
    );
    assert_eq!(
        field("queue_wait_ms"),
        Some(opentelemetry::Value::I64(42_000))
    );
}
