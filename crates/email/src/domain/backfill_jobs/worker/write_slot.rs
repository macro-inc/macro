use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Preserve refusal policy for bulk backfill writes.
pub fn admit_write_slot<P>(
    acquired: Result<Option<P>, anyhow::Error>,
) -> Result<P, ProcessingError> {
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
            error.context("backfill write slots are unavailable"),
        )),
    }
}
