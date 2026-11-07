//! Bounded, internal maintenance of notification history.
//!
//! Retention applies to the parent notification's creation time, independently
//! of recipient state. The scheduler is the authorization boundary: this use
//! case is deliberately not exposed by a user-facing API.

use std::{num::NonZeroU16, time::Duration};

use chrono::{DateTime, NaiveDateTime, TimeDelta, Utc};
use rootcause::{Report, bail};
use tokio::time::Instant;

/// Notifications live for thirty complete UTC days.
pub const RETENTION: TimeDelta = TimeDelta::days(30);
const BATCH_SIZE: NonZeroU16 = NonZeroU16::new(100).unwrap();
const MAX_BATCHES: u16 = 100;
const MAX_RUN_TIME: Duration = Duration::from_secs(100);
const BATCH_HEADROOM: Duration = Duration::from_secs(15);
const BATCH_PAUSE: Duration = Duration::from_millis(250);

/// Explicitly distinguish a read-only preview from destructive cleanup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetentionMode {
    /// Inspect at most one batch without taking deletion locks or deleting rows.
    DryRun,
    /// Delete expired notifications and their dependent rows.
    Delete,
}

/// A bounded preview; the count is a sample, not the total backlog.
#[derive(Debug, Default)]
pub struct RetentionPreview {
    /// Number of expired parents in the sampled batch.
    pub sampled_expired: u64,
    /// Creation time of the oldest expired parent, if any.
    pub oldest_expired_at: Option<NaiveDateTime>,
}

/// Outcome of one independently committed deletion transaction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetentionBatch {
    /// Number of deleted parents (not the number of cascaded recipient rows).
    Deleted(u64),
    /// Another cleanup transaction holds the maintenance lock.
    Busy,
    /// The transaction rolled back after a statement or lock timeout.
    TimedOut,
}

/// Storage capabilities needed by the internal retention use case.
pub trait NotificationRetentionRepository: Send + Sync {
    /// Use the database clock, not the worker's wall clock, for the cutoff.
    fn current_time(&self) -> impl Future<Output = Result<DateTime<Utc>, Report>> + Send;

    /// Inspect only the oldest `limit` expired parents using an ordered index.
    fn preview(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> impl Future<Output = Result<RetentionPreview, Report>> + Send;

    /// Atomically delete at most `limit` parents strictly older than `cutoff`.
    /// Preserve cascade/notification triggers, skip locked parents, and release
    /// the maintenance lock on commit or rollback, including on cancellation.
    fn delete_batch(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> impl Future<Output = Result<RetentionBatch, Report>> + Send;
}

/// Why an invocation stopped. A zero-row batch may mean rows were locked;
/// it is not proof that the backlog has been completely drained.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetentionStop {
    /// Read-only preview completed.
    DryRun,
    /// No currently available expired parents.
    NoCandidates,
    /// Another cleanup invocation is working.
    Busy,
    /// Leave enough time to finish the current invocation safely.
    TimeBudget,
    /// The per-invocation batch cap was reached.
    BatchLimit,
}

/// Summary suitable for operational logs; contains no recipient data.
#[derive(Debug)]
pub struct RetentionReport {
    /// Fixed UTC cutoff shared by every batch in this invocation.
    pub cutoff: NaiveDateTime,
    /// Bounded snapshot taken before deletion.
    pub preview: RetentionPreview,
    /// Number of parent notifications deleted by committed batches.
    pub deleted: u64,
    /// Number of batches attempted, including timeout retries.
    pub batches: u16,
    /// Reason this invocation stopped.
    pub stopped: RetentionStop,
}

/// Enforces retention policy and throttles maintenance work between commits.
pub struct NotificationRetentionService<R> {
    repository: R,
}

impl<R: NotificationRetentionRepository> NotificationRetentionService<R> {
    /// Construct the internal service over its storage port.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Run a bounded sweep. Retries are safe: committed deletes disappear from
    /// the next scan, and skipped/rolled-back rows are reconsidered next time.
    #[tracing::instrument(err, skip(self), fields(deleted, batches, stopped))]
    pub async fn run(
        &self,
        mode: RetentionMode,
        time_budget: Duration,
    ) -> Result<RetentionReport, Report> {
        let deadline = Instant::now() + time_budget.min(MAX_RUN_TIME);
        let cutoff = (self.repository.current_time().await? - RETENTION).naive_utc();
        let preview = self.repository.preview(cutoff, BATCH_SIZE).await?;
        let mut report = RetentionReport {
            cutoff,
            preview,
            deleted: 0,
            batches: 0,
            stopped: RetentionStop::DryRun,
        };

        if mode == RetentionMode::Delete {
            let mut batch_size = BATCH_SIZE;
            report.stopped = loop {
                if report.batches >= MAX_BATCHES {
                    break RetentionStop::BatchLimit;
                }
                if Instant::now() + BATCH_HEADROOM >= deadline {
                    break RetentionStop::TimeBudget;
                }
                report.batches += 1;
                match self.repository.delete_batch(cutoff, batch_size).await? {
                    RetentionBatch::Busy => break RetentionStop::Busy,
                    RetentionBatch::Deleted(0) => break RetentionStop::NoCandidates,
                    RetentionBatch::Deleted(deleted) => {
                        report.deleted += deleted;
                        tracing::info!(
                            deleted,
                            batch = report.batches,
                            "notification retention batch committed"
                        );
                    }
                    RetentionBatch::TimedOut => {
                        let Some(smaller) = NonZeroU16::new(batch_size.get() / 2) else {
                            bail!(
                                "notification retention timed out deleting a single parent; inspect recipient fanout and locks"
                            );
                        };
                        batch_size = smaller;
                        tracing::warn!(
                            batch_size = batch_size.get(),
                            "notification retention batch timed out; reducing batch size"
                        );
                    }
                }
                tokio::time::sleep(BATCH_PAUSE).await;
            };
        }

        tracing::Span::current().record("deleted", report.deleted);
        tracing::Span::current().record("batches", report.batches);
        tracing::Span::current().record("stopped", tracing::field::debug(report.stopped));
        tracing::info!(
            %cutoff,
            sampled_expired = report.preview.sampled_expired,
            oldest_expired_at = ?report.preview.oldest_expired_at,
            deleted = report.deleted,
            batches = report.batches,
            stopped = ?report.stopped,
            "notification retention sweep complete"
        );
        Ok(report)
    }
}

#[cfg(test)]
mod test;
