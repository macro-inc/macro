//! Bounded rollout maintenance for legacy reconciliation provider metadata.
use std::{future::Future, time::Duration};
use tracing::Span;
use uuid::Uuid;

/// The queue's existing composite primary key bounds each transaction.
pub const PAGE_SIZE: i64 = 1000;
/// Two validation statements have 60-second budgets, leaving cleanup headroom.
pub const LEASE_SECONDS: i32 = 180;
/// Only definite inconsistent-row failures consume this finite attempt budget.
pub const MAX_CONSTRAINT_FAILURES: i32 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum RepairPhase {
    Scanning,
    Validating,
    Complete,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RepairProgress {
    pub batches: i64,
    pub link_rows_scanned: i64,
    pub message_rows_scanned: i64,
    pub rows_repaired: i64,
    pub validation_failures: i32,
    pub constraint_failures: i32,
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

#[derive(Clone, Copy, Debug, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ValidationTarget {
    Streams,
    Reconciliation,
}

/// Keep actual failures separate from the hourly alarm heartbeat after capping.
#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ValidationDeferral {
    NotValidation,
    TransientFailure,
    ConstraintViolation,
    CappedHeartbeat,
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
    #[error("legacy mailbox work has an inconsistent provider")]
    ConstraintViolation(ValidationTarget),
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
    /// Require the persisted scan-complete marker before taking validation locks.
    /// Validation is off the request path and never makes a deploy fail.
    fn validate(
        &self,
        lease: RepairLease,
    ) -> impl Future<Output = Result<RepairProgress, RepairError>> + Send;
    /// Only a definite constraint violation advances the separate capped count.
    fn defer(
        &self,
        lease: RepairLease,
        seconds: u32,
        reason: ValidationDeferral,
    ) -> impl Future<Output = Result<RepairProgress, RepairError>> + Send;
}

pub enum RepairTick {
    Busy,
    Progress(RepairBatch),
    ValidationDeferred,
    ValidationBlocked,
    Complete,
}

impl RepairTick {
    pub fn delay(&self) -> Duration {
        match self {
            Self::Progress(_) => Duration::from_millis(250),
            Self::ValidationBlocked => Duration::from_secs(3600),
            Self::Busy | Self::ValidationDeferred | Self::Complete => Duration::from_secs(5),
        }
    }
}

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Outcome {
    Busy,
    Progress,
    ValidationDeferred,
    ValidationBlocked,
    Complete,
    Failed,
}

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Remaining {
    Unscanned,
    AwaitingValidation,
    Blocked,
    None,
}

fn record(progress: RepairProgress, phase: RepairPhase, outcome: Outcome) {
    let span = Span::current();
    let capped =
        phase == RepairPhase::Validating && progress.constraint_failures >= MAX_CONSTRAINT_FAILURES;
    span.record("backfill.batches", progress.batches);
    span.record("backfill.links_scanned", progress.link_rows_scanned);
    span.record("backfill.rows_scanned", progress.message_rows_scanned);
    span.record("backfill.rows_repaired", progress.rows_repaired);
    span.record("backfill.validation_failures", progress.validation_failures);
    span.record("backfill.constraint_failures", progress.constraint_failures);
    span.record("backfill.validation_capped", capped);
    span.record("backfill.phase", phase.as_ref());
    span.record("backfill.outcome", outcome.as_ref());
    let remaining = match phase {
        RepairPhase::Scanning => Remaining::Unscanned,
        RepairPhase::Validating if capped => Remaining::Blocked,
        RepairPhase::Validating => Remaining::AwaitingValidation,
        RepairPhase::Complete => Remaining::None,
    };
    span.record("backfill.remaining", remaining.as_ref());
}

#[tracing::instrument(
    skip_all,
    name = "email.reconciliation.provider_backfill",
    fields(
        backfill.batches = tracing::field::Empty,
        backfill.links_scanned = tracing::field::Empty,
        backfill.rows_scanned = tracing::field::Empty,
        backfill.rows_repaired = tracing::field::Empty,
        backfill.validation_failures = tracing::field::Empty,
        backfill.constraint_failures = tracing::field::Empty,
        backfill.validation_capped = tracing::field::Empty,
        backfill.stream_provider_mismatch_count = tracing::field::Empty,
        backfill.validation_target = tracing::field::Empty,
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
    match lease.phase {
        RepairPhase::Scanning => match repository.scan(lease).await {
            Ok(batch) => {
                record(batch.progress, batch.phase, Outcome::Progress);
                Ok(RepairTick::Progress(batch))
            }
            Err(error) => {
                let _ = repository
                    .defer(lease, 5, ValidationDeferral::NotValidation)
                    .await;
                record(lease.progress, lease.phase, Outcome::Failed);
                Err(error)
            }
        },
        RepairPhase::Validating => {
            if lease.progress.constraint_failures >= MAX_CONSTRAINT_FAILURES {
                // Keep the durable blocked state visible even if scheduling
                // its next alarm heartbeat encounters a database outage.
                record(lease.progress, lease.phase, Outcome::ValidationBlocked);
                tracing::error!(
                    "Mailbox-work provider validation is capped; inconsistent rows need investigation"
                );
                repository
                    .defer(lease, 3600, ValidationDeferral::CappedHeartbeat)
                    .await?;
                return Ok(RepairTick::ValidationBlocked);
            }
            match repository.validate(lease).await {
                Ok(progress) => {
                    record(progress, RepairPhase::Complete, Outcome::Complete);
                    Ok(RepairTick::Complete)
                }
                Err(error) => {
                    let reason = if let RepairError::ConstraintViolation(target) = &error {
                        Span::current().record("backfill.validation_target", target.as_ref());
                        if matches!(target, ValidationTarget::Streams) {
                            // Classification events, not an invented count of all bad rows.
                            Span::current().record("backfill.stream_provider_mismatch_count", 1);
                        }
                        ValidationDeferral::ConstraintViolation
                    } else {
                        ValidationDeferral::TransientFailure
                    };
                    let failures = u32::try_from(lease.progress.validation_failures)
                        .map_err(|_| RepairError::InvalidState)?;
                    let delay = 60 * (1_u32 << failures.min(6));
                    let deferred = repository.defer(lease, delay.min(3600), reason).await;
                    let progress = match &deferred {
                        Ok(progress) => *progress,
                        Err(_) => lease.progress,
                    };
                    let capped = progress.constraint_failures >= MAX_CONSTRAINT_FAILURES;
                    record(
                        progress,
                        lease.phase,
                        if capped {
                            Outcome::ValidationBlocked
                        } else {
                            Outcome::ValidationDeferred
                        },
                    );
                    tracing::error!(
                        error.class = error.as_ref(),
                        "Mailbox-work provider constraints remain unvalidated"
                    );
                    deferred?;
                    Ok(if capped {
                        RepairTick::ValidationBlocked
                    } else {
                        RepairTick::ValidationDeferred
                    })
                }
            }
        }
        RepairPhase::Complete => Err(RepairError::InvalidState),
    }
}
