use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};

/// Moves a population an older release queued on the backfill queue onto the
/// population queue, as a new request. During a rolling deploy old producers
/// still send `PopulateCrmContact` and `PopulateCrmPolicy` here; forwarding
/// them reads no database row and takes no slot, so they never hold a
/// backfill worker.
pub(super) async fn forward_crm_contact<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &LinkScopedPayload<PopulateCrmContactPayload>,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    super::message::request_crm_populations(ctx, scope.link_id, vec![scope.payload.clone()]).await
}

/// Moves one page of durable history to the population queue; see
/// [`forward_crm_contact`].
pub(super) async fn forward_crm_policy_page<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    page: &PopulateCrmPolicyPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    ctx.queue
        .enqueue_crm_policy_page(page.clone())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e
                    .into_original()
                    .context("Failed to forward a CRM history page"),
            })
        })
}
