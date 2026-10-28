//! Admission to the fleet's backfill write slots
//! (`util::redis::backfill_write_slots`).

use crate::pubsub::context::PubSubContext;
use crate::util::redis::backfill_write_slots::BackfillWriteSlot;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Takes a backfill write slot for one write. A slot that stays taken,
/// or Redis failing to decide, refuses the write so the operation is deferred
/// instead of written unmetered.
pub(super) async fn acquire(ctx: &PubSubContext) -> Result<BackfillWriteSlot, ProcessingError> {
    let refused = |source: anyhow::Error| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::BackfillWritesBusy,
            source,
        })
    };
    match ctx.redis_client.acquire_backfill_write_slot().await {
        Ok(Some(slot)) => Ok(slot),
        Ok(None) => Err(refused(anyhow::anyhow!(
            "no backfill write slot freed up in time"
        ))),
        Err(error) => Err(refused(
            anyhow::Error::new(error).context("backfill write slots are unavailable"),
        )),
    }
}
