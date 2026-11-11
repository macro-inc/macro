//! Admission to the fleet's backfill write slots
//! (`util::redis::backfill_write_slots`).

use crate::pubsub::context::PubSubContext;
use crate::util::redis::backfill_write_slots::BackfillWriteSlot;
use email::domain::backfill_jobs::worker::admit_write_slot;
use models_email::service::pubsub::ProcessingError;

/// Takes a backfill write slot for one write. A slot that stays taken,
/// or Redis failing to decide, refuses the write so the operation is deferred
/// instead of written unmetered.
pub(super) async fn acquire(ctx: &PubSubContext) -> Result<BackfillWriteSlot, ProcessingError> {
    admit_write_slot(
        ctx.redis_client
            .acquire_backfill_write_slot()
            .await
            .map_err(anyhow::Error::new),
    )
}
