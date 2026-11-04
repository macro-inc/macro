//! Durable progress for whole-thread imports. Legacy counters have no delivery
//! identities and cannot be reconciled from message presence; those jobs wait
//! for the explicit recovery procedure instead of guessing at completion.

use crate::util::redis::RedisClient;
use email_db_client::backfill::progress;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqlx::PgPool;
use uuid::Uuid;

/// Refuse legacy work before provider reads or writes. Deferral preserves its
/// receive budget while operators arrange a fresh, complete recovery sweep.
#[tracing::instrument(skip(db), err)]
pub async fn require_durable(db: &PgPool, job_id: Uuid) -> Result<(), ProcessingError> {
    if progress::is_tracked(db, job_id).await.map_err(|source| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source,
        })
    })? {
        return Ok(());
    }
    Err(ProcessingError::Retryable(DetailedError {
        reason: FailureReason::BackfillProgressNeedsRecovery,
        source: anyhow::anyhow!(
            "legacy backfill requires the reviewed backfill progress recovery procedure"
        ),
    }))
}

/// Best-effort cleanup of obsolete Redis keys. Durable completion identities
/// remain until the parent job is deleted, including across cancellation races.
pub async fn clear_job(_db: &PgPool, redis: &RedisClient, job_id: Uuid) {
    let _ = redis.delete_backfill_job_progress(job_id).await;
}

#[cfg(test)]
mod test;
