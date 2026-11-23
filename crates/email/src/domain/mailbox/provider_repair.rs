//! Bounded rollout maintenance for legacy reconciliation provider metadata.
use std::{future::Future, time::Duration};
use tracing::Span;
use uuid::Uuid;

/// The queue's existing composite primary key bounds each transaction.
pub const PAGE_SIZE: i64 = 1000;
/// Leave cleanup headroom around the bounded page's statement deadlines.
pub const LEASE_SECONDS: i32 = 180;

#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum RepairPhase {
    Scanning,
    Complete,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RepairProgress {
    pub batches: i64,
    pub link_rows_scanned: i64,
    pub message_rows_scanned: i64,
    pub rows_repaired: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct RepairLease {
    pub id: Uuid,
    pub phase: RepairPhase,
    pub progress: RepairProgress,
}

pub enum RepairClaim {
    Busy,
    Complete(RepairProgress),
    Acquired(RepairLease),
}

#[derive(Debug, thiserror::Error, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum RepairError {
    #[error("maintenance storage unavailable")]
    Unavailable,
    #[error("maintenance lock busy")]
    LockBusy,
    #[error("maintenance statement deadline exceeded")]
    Deadline,
    #[error("maintenance lease changed")]
    LeaseLost,
    #[error("maintenance progress is invalid")]
    InvalidState,
}

pub struct RepairBatch {
    pub phase: RepairPhase,
    pub progress: RepairProgress,
}

pub trait ProviderRepairRepository: Send + Sync {
    fn claim(&self, id: Uuid) -> impl Future<Output = Result<RepairClaim, RepairError>> + Send;
    /// Repair and advance at most one bounded page atomically under the lease.
    /// New and old writers must keep deriving the provider from the parent.
    fn scan(
        &self,
        lease: RepairLease,
    ) -> impl Future<Output = Result<RepairBatch, RepairError>> + Send;
    /// Release the same live lease with a bounded retry delay after page failure.
    fn defer(
        &self,
        lease: RepairLease,
        seconds: u32,
    ) -> impl Future<Output = Result<RepairProgress, RepairError>> + Send;
}

pub enum RepairTick {
    Busy,
    Progress(RepairBatch),
    Complete,
}

impl RepairTick {
    pub fn delay(&self) -> Duration {
        match self {
            Self::Progress(_) => Duration::from_millis(250),
            Self::Busy | Self::Complete => Duration::from_secs(5),
        }
    }
}

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Outcome {
    Busy,
    Progress,
    Complete,
    Failed,
}

fn record(progress: RepairProgress, phase: RepairPhase, outcome: Outcome) {
    let span = Span::current();
    span.record("backfill.batches", progress.batches);
    span.record("backfill.links_scanned", progress.link_rows_scanned);
    span.record("backfill.rows_scanned", progress.message_rows_scanned);
    span.record("backfill.rows_repaired", progress.rows_repaired);
    span.record("backfill.phase", phase.as_ref());
    span.record("backfill.outcome", outcome.as_ref());
    span.record(
        "backfill.remaining",
        match phase {
            RepairPhase::Scanning => "unscanned",
            RepairPhase::Complete => "none",
        },
    );
}

#[tracing::instrument(
    skip_all,
    name = "email.reconciliation.provider_backfill",
    fields(
        backfill.batches = tracing::field::Empty,
        backfill.links_scanned = tracing::field::Empty,
        backfill.rows_scanned = tracing::field::Empty,
        backfill.rows_repaired = tracing::field::Empty,
        backfill.phase = tracing::field::Empty,
        backfill.outcome = tracing::field::Empty,
        backfill.remaining = tracing::field::Empty,
    )
)]
pub async fn repair_once(
    repository: &impl ProviderRepairRepository,
) -> Result<RepairTick, RepairError> {
    let lease = match repository.claim(Uuid::now_v7()).await? {
        RepairClaim::Busy => {
            Span::current().record("backfill.outcome", Outcome::Busy.as_ref());
            return Ok(RepairTick::Busy);
        }
        RepairClaim::Complete(progress) => {
            record(progress, RepairPhase::Complete, Outcome::Complete);
            return Ok(RepairTick::Complete);
        }
        RepairClaim::Acquired(lease) => lease,
    };
    if lease.phase != RepairPhase::Scanning {
        return Err(RepairError::InvalidState);
    }
    match repository.scan(lease).await {
        Ok(batch) if batch.phase == RepairPhase::Complete => {
            record(batch.progress, batch.phase, Outcome::Complete);
            Ok(RepairTick::Complete)
        }
        Ok(batch) => {
            record(batch.progress, batch.phase, Outcome::Progress);
            Ok(RepairTick::Progress(batch))
        }
        Err(error) => {
            let _ = repository.defer(lease, 5).await;
            record(lease.progress, lease.phase, Outcome::Failed);
            Err(error)
        }
    }
}
