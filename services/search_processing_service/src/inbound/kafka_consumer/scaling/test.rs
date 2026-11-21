use std::{
    convert::Infallible,
    sync::{Arc, Mutex},
};

use super::*;
use crate::domain::backlog::LaneBacklog;
use crate::inbound::kafka_consumer::metrics::test::Recorded;

/// Records every backlog published to it.
#[derive(Clone, Default)]
struct RecordingSink(Arc<Mutex<Vec<LaneBacklog>>>);

impl BacklogSink for RecordingSink {
    type Err = Infallible;

    async fn publish(&self, backlog: LaneBacklog) -> Result<(), Infallible> {
        self.0.lock().expect("sink lock").push(backlog);
        Ok(())
    }
}

/// Fails every publish, counting the attempts.
#[derive(Clone, Default)]
struct FailingSink(Arc<Mutex<u32>>);

#[derive(Debug, thiserror::Error)]
#[error("CloudWatch is down")]
struct Down;

impl BacklogSink for FailingSink {
    type Err = Down;

    async fn publish(&self, _backlog: LaneBacklog) -> Result<(), Down> {
        *self.0.lock().expect("sink lock") += 1;
        Err(Down)
    }
}

/// Now on tokio's clock, which a paused test advances.
fn now() -> std::time::Instant {
    tokio::time::Instant::now().into_std()
}

/// Records `readings` every 10 s until `stop`, as the consumer's sampler
/// does.
fn keep_sampling(
    metrics: IndexMetrics,
    readings: &'static [(&'static str, i32, u64)],
    stop: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            for &(topic, partition, age_ms) in readings {
                metrics.pending_ages().set(topic, partition, age_ms, now());
            }
            tokio::select! {
                () = stop.cancelled() => break,
                () = tokio::time::sleep(Duration::from_secs(10)) => {}
            }
        }
    })
}

async fn run_for<S: BacklogSink>(metrics: &IndexMetrics, sink: S, duration: Duration) {
    let shutdown = CancellationToken::new();
    let publisher = tokio::spawn(publish_lane_backlog(
        metrics.clone(),
        sink,
        shutdown.clone(),
    ));
    tokio::time::sleep(duration).await;
    shutdown.cancel();
    publisher.await.expect("publisher stops");
}

#[tokio::test(start_paused = true)]
async fn the_backlog_is_published_every_interval_until_shutdown() {
    let recorded = Recorded::new();
    let sampling = CancellationToken::new();
    let sampler = keep_sampling(
        recorded.metrics.clone(),
        &[("macro.email", 2, 90_000), ("macro.documents", 0, 12_000)],
        sampling.clone(),
    );
    let sink = RecordingSink::default();

    run_for(
        &recorded.metrics,
        sink.clone(),
        PUBLISH_INTERVAL * 2 + Duration::from_secs(1),
    )
    .await;
    sampling.cancel();
    sampler.await.expect("sampler stops");

    let published = sink.0.lock().expect("sink lock").clone();
    assert_eq!(
        published,
        vec![
            LaneBacklog {
                live: Some(Duration::from_secs(12)),
                email: Some(Duration::from_secs(90)),
            };
            3
        ],
        "one at start, then one per interval"
    );
}

#[tokio::test(start_paused = true)]
async fn readings_that_stop_arriving_stop_being_published() {
    let recorded = Recorded::new();
    recorded
        .metrics
        .pending_ages()
        .set("macro.documents", 0, 1_000, now());
    let sink = RecordingSink::default();

    run_for(
        &recorded.metrics,
        sink.clone(),
        PUBLISH_INTERVAL * 2 + Duration::from_secs(1),
    )
    .await;

    assert_eq!(
        sink.0.lock().expect("sink lock").len(),
        1,
        "only the round while the reading was fresh"
    );
}

#[tokio::test(start_paused = true)]
async fn a_task_without_readings_publishes_nothing() {
    let recorded = Recorded::new();
    let sink = RecordingSink::default();

    run_for(
        &recorded.metrics,
        sink.clone(),
        PUBLISH_INTERVAL + Duration::from_secs(1),
    )
    .await;

    assert!(sink.0.lock().expect("sink lock").is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_failed_publish_is_retried_next_round() {
    let recorded = Recorded::new();
    let sampling = CancellationToken::new();
    let sampler = keep_sampling(
        recorded.metrics.clone(),
        &[("macro.documents", 0, 1_000)],
        sampling.clone(),
    );
    let sink = FailingSink::default();

    run_for(
        &recorded.metrics,
        sink.clone(),
        PUBLISH_INTERVAL + Duration::from_secs(1),
    )
    .await;
    sampling.cancel();
    sampler.await.expect("sampler stops");

    assert_eq!(*sink.0.lock().expect("sink lock"), 2);
}
