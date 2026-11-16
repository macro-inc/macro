#![recursion_limit = "256"]

use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{Instant, advance, timeout};
use tokio_util::sync::CancellationToken;
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::SubscriberExt};

struct DrainErrors(mpsc::UnboundedSender<()>);

impl<S: tracing::Subscriber> Layer<S> for DrainErrors {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _context: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if event.metadata().target() == "email_service::backfill_outbox"
            && *event.metadata().level() == tracing::Level::ERROR
        {
            self.0.send(()).unwrap();
        }
    }
}

#[tokio::test(start_paused = true)]
async fn polls_all_drains_immediately_every_five_seconds_and_stops_on_cancellation() {
    // A closed pool makes each real drain fail immediately. Its loop-level error
    // observes the attempted pass without any database, queue, or timer seam.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1/unused")
        .unwrap();
    pool.close().await;
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .region(aws_sdk_sqs::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_sqs::config::Credentials::new(
            "test", "test", None, None, "test",
        ))
        .build();
    let sqs = sqs_client::SQS::new(aws_sdk_sqs::Client::from_conf(config));
    let cancellation = CancellationToken::new();
    let (sender, mut errors) = mpsc::unbounded_channel();
    let subscriber = tracing_subscriber::registry().with(DrainErrors(sender));
    let started = Instant::now();
    let worker = tokio::spawn(
        email_service::backfill_outbox::run(pool, sqs, cancellation.clone())
            .with_subscriber(subscriber),
    );

    for _ in 0..3 {
        assert_eq!(
            timeout(Duration::from_millis(1), errors.recv())
                .await
                .unwrap(),
            Some(())
        );
    }
    assert_eq!(
        Instant::now(),
        started,
        "first pass must not wait for a tick"
    );

    for tick in 1..=2 {
        advance(Duration::from_secs(4)).await;
        assert!(matches!(
            errors.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
        advance(Duration::from_secs(1)).await;
        for _ in 0..3 {
            assert_eq!(
                timeout(Duration::from_millis(1), errors.recv())
                    .await
                    .unwrap(),
                Some(())
            );
        }
        assert_eq!(Instant::now(), started + Duration::from_secs(5 * tick));
    }

    cancellation.cancel();
    timeout(Duration::from_millis(1), worker)
        .await
        .expect("cancellation must interrupt the five-second wait")
        .unwrap();
    assert_eq!(Instant::now(), started + Duration::from_secs(10));
    advance(Duration::from_secs(5)).await;
    assert_eq!(
        errors.recv().await,
        None,
        "cancelled loop must not drain again"
    );
}
