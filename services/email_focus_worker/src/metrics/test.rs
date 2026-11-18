use tokio::sync::mpsc;

use super::*;

#[test]
fn counts_sum_and_samples_keep_every_value_until_taken() {
    let metrics = FocusMetrics::default();
    let other = metrics.clone();
    metrics.add(Metric::ClassifierCalls, 2.0);
    other.add(Metric::ClassifierCalls, 3.0);
    metrics.observe(Metric::SweepSeconds, 1.5);
    other.observe(Metric::SweepSeconds, 0.5);

    let batch = metrics.take();
    assert_eq!(batch.sums[&Metric::ClassifierCalls], 5.0);
    assert_eq!(batch.samples[&Metric::SweepSeconds], vec![1.5, 0.5]);

    // Taken: every count starts again at 0, and no samples are left.
    let next = other.take();
    assert_eq!(next.sums[&Metric::ClassifierCalls], 0.0);
    assert!(next.samples.is_empty());
}

#[test]
fn every_count_goes_out_even_at_zero_and_samples_only_when_seen() {
    use strum::IntoEnumIterator as _;
    let batch = FocusMetrics::default().take();
    for metric in Metric::iter() {
        assert_eq!(
            batch.sums.contains_key(&metric),
            !metric.is_sample(),
            "{metric:?}"
        );
    }
    assert!(batch.samples.is_empty());
}

#[test]
fn every_metric_has_a_name_and_a_unit() {
    use strum::IntoEnumIterator as _;
    for metric in Metric::iter() {
        assert!(!metric.name().is_empty());
    }
    assert_eq!(Metric::JevCostUsd.name(), "JevCostUsd");
    assert_eq!(Metric::StaleThreadsSeconds.unit(), Unit::Seconds);
    assert_eq!(Metric::DueDateCostUsd.unit(), Unit::Dollars);
    assert_eq!(Metric::ClassifierCalls.unit(), Unit::Count);
}

#[test]
fn samples_go_out_as_distinct_values_with_counts() {
    assert_eq!(
        distinct_values(&[0.2, 1.0, 0.2004, f64::NAN, 1.0, 1.0]),
        vec![(0.2, 2.0), (1.0, 3.0)]
    );
}

/// Hands each batch to the test.
struct Channel(mpsc::UnboundedSender<Batch>);

impl MetricSink for Channel {
    async fn publish(&self, batch: &Batch) -> Result<(), Report> {
        self.0.send(batch.clone()).ok();
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn a_batch_goes_out_at_start_each_minute_and_the_last_one_at_shutdown() {
    let metrics = FocusMetrics::default();
    // Recorded before the publisher starts, as `main` does.
    metrics.add(Metric::WorkerStarts, 1.0);
    let (sender, mut published) = mpsc::unbounded_channel();
    let shutdown = CancellationToken::new();
    let publisher = tokio::spawn(run_publisher(
        metrics.clone(),
        Channel(sender),
        shutdown.clone(),
    ));

    // The start goes out without waiting a minute.
    let first = published.recv().await.unwrap();
    assert_eq!(first.sums[&Metric::WorkerStarts], 1.0);

    // A quiet minute still publishes its zeros; what is left goes out at
    // shutdown.
    tokio::time::advance(PUBLISH_INTERVAL).await;
    let quiet = published.recv().await.unwrap();
    assert_eq!(quiet.sums[&Metric::WorkerStarts], 0.0);
    assert!(quiet.samples.is_empty());
    metrics.observe(Metric::SweepSeconds, 12.0);
    shutdown.cancel();
    publisher.await.unwrap();
    let last = published.recv().await.unwrap();
    assert_eq!(last.samples[&Metric::SweepSeconds], vec![12.0]);
    assert!(published.recv().await.is_none());
}
