use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use rand::Rng;
use std::ops::RangeInclusive;
use std::time::Duration;

/// How long a CRM population refused its team's slot is deferred. A team's
/// slots stay taken while it is paused or busy with its own populations, so
/// trying again within seconds only spends backfill workers. SQS delays a
/// message at most 15 minutes.
const CRM_TEAM_BUSY_DEFERRAL: RangeInclusive<Duration> =
    Duration::from_secs(10 * 60)..=Duration::from_secs(15 * 60);

/// Every CRM population slot of a team was taken. The refusal carries the
/// delay its operation is deferred by, as a Gmail rate limit's Retry-After.
#[derive(Debug, thiserror::Error)]
#[error("every CRM population slot of the team is taken")]
pub struct CrmTeamSlotsBusy {
    pub retry_after: Duration,
}

/// Preserve refusal policy for both CRM populations and bulk backfill writes.
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

/// Admits a CRM population or history page into one of its team's slots. A
/// refused one is deferred for [`CRM_TEAM_BUSY_DEFERRAL`]; slots that can't be
/// read defer as a backfill write's do.
pub fn admit_crm_slot<P>(acquired: Result<Option<P>, anyhow::Error>) -> Result<P, ProcessingError> {
    match acquired {
        Ok(None) => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::BackfillWritesBusy,
            source: CrmTeamSlotsBusy {
                retry_after: rand::rng().random_range(CRM_TEAM_BUSY_DEFERRAL),
            }
            .into(),
        })),
        acquired => admit_write_slot(acquired),
    }
}
