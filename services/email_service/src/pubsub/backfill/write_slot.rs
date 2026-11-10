//! Admission to the fleet's backfill write slots
//! (`util::redis::backfill_write_slots`).

use crate::pubsub::context::PubSubContext;
use crate::util::redis::backfill_write_slots::BackfillWriteSlot;
use email_types::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Takes a backfill write slot for one write. A slot that stays taken,
/// or Redis failing to decide, refuses the write so the operation is deferred
/// instead of written unmetered.
pub(super) async fn acquire(ctx: &PubSubContext) -> Result<BackfillWriteSlot, ProcessingError> {
    admit(ctx.redis_client.acquire_backfill_write_slot().await)
}

/// Takes one of a team's CRM population slots, refusing like [`acquire`].
pub(super) async fn acquire_crm_population(
    ctx: &PubSubContext,
    team_id: uuid::Uuid,
) -> Result<BackfillWriteSlot, ProcessingError> {
    admit(ctx.redis_client.acquire_crm_population_slot(team_id).await)
}

fn admit(
    acquired: redis::RedisResult<Option<BackfillWriteSlot>>,
) -> Result<BackfillWriteSlot, ProcessingError> {
    let refused = |source: anyhow::Error| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::BackfillWritesBusy,
            source,
        })
    };
    match acquired {
        Ok(Some(slot)) => Ok(slot),
        Ok(None) => Err(refused(anyhow::anyhow!(
            "no backfill write slot freed up in time"
        ))),
        Err(error) => Err(refused(
            anyhow::Error::new(error).context("backfill write slots are unavailable"),
        )),
    }
}
