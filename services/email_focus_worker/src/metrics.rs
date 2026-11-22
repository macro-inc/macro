//! The rollout's numbers: gathered in memory as the worker runs and published
//! once a minute.
//!
//! Each go/stop number of the Focus rollout comes from here: what classifying
//! costs, how often the classifier and the due date fail, how long mail waits to
//! be classified, how long a sweep runs and a new inbox takes to fill, and how
//! long the stale-thread read takes. A publish that fails is logged and dropped:
//! the numbers never hold up or stop the worker.
//!
//! Every counted metric goes out each minute, as 0 when nothing happened, so
//! a rule can always divide one by another and a missing value means the
//! worker isn't publishing.

use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};

use rootcause::Report;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// How often the numbers are published: CloudWatch's standard resolution.
const PUBLISH_INTERVAL: Duration = Duration::from_secs(60);

/// What a metric measures, so its publisher can give it a unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Count,
    Seconds,
    /// US dollars; CloudWatch has no currency unit.
    Dollars,
}

/// One number the worker reports. Counts are summed per publish; samples keep
/// every value, so percentiles can be read from them.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, strum::IntoStaticStr, strum::EnumIter,
)]
pub enum Metric {
    /// A worker process started; many in a short time is a crash loop.
    WorkerStarts,
    /// Questions sent to the classifier, one per classified thread.
    ClassifierCalls,
    /// Classifier calls that timed out, were rate limited or found it down.
    ClassifierUnavailable,
    /// Classifier calls it refused or answered unusably.
    ClassifierRejected,
    /// Times Jev found TypeSafe unavailable (a rate limit, overload, timeout,
    /// server or connection error) and the worker halved its token rate.
    ClassifierSlowDowns,
    /// How long a backfill or sweep call waited on the token budget (sample).
    ClassifierBudgetWaitSeconds,
    /// Jev input tokens.
    JevInputTokens,
    /// Jev output tokens.
    JevOutputTokens,
    /// What Jev's tokens cost, at the stored price of its model.
    JevCostUsd,
    /// Due dates asked of the agent harness.
    DueDateCalls,
    /// Due date asks that failed or ran out of time.
    DueDateFailures,
    /// Due date input tokens, cached ones included.
    DueDateInputTokens,
    /// Due date output tokens.
    DueDateOutputTokens,
    /// What due dates cost, at the stored price of the harness's model.
    DueDateCostUsd,
    /// Inboxes in the rollout (their owner or a user they are linked to has
    /// the flag), per look (sample).
    EnrolledInboxes,
    /// Inboxes whose place in the rollout a look could not read.
    EnrollmentUnknown,
    /// From an email event's publish to its thread's classification (sample).
    EventToClassifiedSeconds,
    /// How long one sweep took (sample).
    SweepSeconds,
    /// Sweeps that failed, or left out an inbox whose threads could not be
    /// read.
    SweepFailures,
    /// Sweeps the classifier stopped before they were done.
    SweepsStoppedEarly,
    /// From an inbox being found in the rollout to the top of its tab filled
    /// (sample).
    BackfillTopFilledSeconds,
    /// From an inbox being found in the rollout to its whole window filled
    /// (sample).
    BackfillFilledSeconds,
    /// Backfill passes that failed.
    BackfillPassFailures,
    /// One page of the stale-thread read (sample).
    StaleThreadsSeconds,
}

impl Metric {
    /// The metric's name where it is published.
    pub fn name(self) -> &'static str {
        self.into()
    }

    /// Whether each value is kept (for percentiles and maxima) rather than
    /// summed.
    pub fn is_sample(self) -> bool {
        matches!(
            self,
            Self::EnrolledInboxes
                | Self::EventToClassifiedSeconds
                | Self::ClassifierBudgetWaitSeconds
                | Self::SweepSeconds
                | Self::BackfillTopFilledSeconds
                | Self::BackfillFilledSeconds
                | Self::StaleThreadsSeconds
        )
    }

    /// What the metric measures.
    pub fn unit(self) -> Unit {
        match self {
            Self::EventToClassifiedSeconds
            | Self::SweepSeconds
            | Self::ClassifierBudgetWaitSeconds
            | Self::BackfillTopFilledSeconds
            | Self::BackfillFilledSeconds
            | Self::StaleThreadsSeconds => Unit::Seconds,
            Self::JevCostUsd | Self::DueDateCostUsd => Unit::Dollars,
            _ => Unit::Count,
        }
    }
}

/// What was recorded since the last publish.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Batch {
    /// Each counted metric's total.
    pub sums: BTreeMap<Metric, f64>,
    /// Each sampled metric's values, in the order recorded.
    pub samples: BTreeMap<Metric, Vec<f64>>,
}

impl Batch {
    fn sum(&self, metric: Metric) -> f64 {
        self.sums.get(&metric).copied().unwrap_or_default()
    }
}

/// Where the worker records its numbers. Cheap to clone; every clone records
/// into the same batch.
#[derive(Clone, Default)]
pub struct FocusMetrics {
    batch: Arc<Mutex<Batch>>,
    /// Cancelled when the worker stops, and work dropped after that is not
    /// counted as failed.
    stopping: CancellationToken,
}

impl FocusMetrics {
    /// Metrics for a worker that stops at `stopping`.
    pub fn new(stopping: CancellationToken) -> Self {
        Self {
            batch: Arc::default(),
            stopping,
        }
    }

    /// Whether the worker is stopping: work it drops then was cancelled, not
    /// failed.
    pub fn stopping(&self) -> bool {
        self.stopping.is_cancelled()
    }

    /// Add `amount` to a counted metric.
    pub fn add(&self, metric: Metric, amount: f64) {
        debug_assert!(!metric.is_sample(), "{metric:?} is sampled, not counted");
        if let Ok(mut batch) = self.batch.lock() {
            *batch.sums.entry(metric).or_default() += amount;
        }
    }

    /// Record one value of a sampled metric.
    pub fn observe(&self, metric: Metric, value: f64) {
        debug_assert!(metric.is_sample(), "{metric:?} is counted, not sampled");
        if let Ok(mut batch) = self.batch.lock() {
            batch.samples.entry(metric).or_default().push(value);
        }
    }

    /// Everything recorded since the last take, with every counted metric,
    /// 0 if nothing was counted.
    pub fn take(&self) -> Batch {
        use strum::IntoEnumIterator as _;
        let mut batch = self
            .batch
            .lock()
            .map(|mut batch| std::mem::take(&mut *batch))
            .unwrap_or_default();
        for metric in Metric::iter().filter(|metric| !metric.is_sample()) {
            batch.sums.entry(metric).or_insert(0.0);
        }
        batch
    }
}

/// Where the numbers go.
pub trait MetricSink: Send + Sync + 'static {
    /// Publish one minute's batch.
    fn publish(&self, batch: &Batch) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Publish what `metrics` gathered to `sink` at once, then every
/// [`PUBLISH_INTERVAL`], and once more at `shutdown`: the first batch carries
/// the start, so a worker that crashes within a minute still counts it.
pub async fn run_publisher<K: MetricSink>(
    metrics: FocusMetrics,
    sink: K,
    shutdown: CancellationToken,
) {
    let mut ticker = tokio::time::interval(PUBLISH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        let stopping = tokio::select! {
            biased;
            () = shutdown.cancelled() => true,
            _ = ticker.tick() => false,
        };
        publish(&metrics.take(), &sink).await;
        if stopping {
            return;
        }
    }
}

/// Publish one batch in its own trace, and log what it cost: the usage log of
/// record for the rollout's cost.
async fn publish<K: MetricSink>(batch: &Batch, sink: &K) {
    let values: usize = batch.samples.values().map(Vec::len).sum();
    let span = tracing::info_span!(
        "email_focus.metrics_publish",
        sums = batch.sums.len(),
        samples = values,
    );
    async {
        tracing::info!(
            classifier_calls = batch.sum(Metric::ClassifierCalls),
            jev_input_tokens = batch.sum(Metric::JevInputTokens),
            jev_output_tokens = batch.sum(Metric::JevOutputTokens),
            jev_cost_usd = batch.sum(Metric::JevCostUsd),
            due_date_calls = batch.sum(Metric::DueDateCalls),
            due_date_input_tokens = batch.sum(Metric::DueDateInputTokens),
            due_date_output_tokens = batch.sum(Metric::DueDateOutputTokens),
            due_date_cost_usd = batch.sum(Metric::DueDateCostUsd),
            "focus usage this minute"
        );
        if let Err(error) = sink.publish(batch).await {
            tracing::warn!(error = ?error, "focus metrics publish failed");
        }
    }
    .instrument(span)
    .await;
}

/// Sampled values as distinct values and how often each occurred, rounded to a
/// thousandth: how CloudWatch takes many values in one datum.
pub fn distinct_values(values: &[f64]) -> Vec<(f64, f64)> {
    let mut counts: HashMap<i64, f64> = HashMap::new();
    for value in values {
        if value.is_finite() {
            // Rounded to thousandths, which fit an i64 for any measured value.
            #[expect(
                clippy::cast_possible_truncation,
                reason = "rounded to thousandths first"
            )]
            let key = (value * 1_000.0).round() as i64;
            *counts.entry(key).or_default() += 1.0;
        }
    }
    let mut distinct: Vec<_> = counts
        .into_iter()
        .map(|(key, count)| (key as f64 / 1_000.0, count))
        .collect();
    distinct.sort_by(|a, b| a.0.total_cmp(&b.0));
    distinct
}
