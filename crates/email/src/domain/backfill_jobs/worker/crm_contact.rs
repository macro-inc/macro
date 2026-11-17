use super::*;
use crate::domain::crm_population::population_requests;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// Moves a queued population of one `(link, contact_email)` to the CRM
/// population ledger, where the population workers attempt it.
///
/// Nothing publishes this operation any more: producers record their requests
/// in the ledger directly. The step drains operations published before that,
/// and by workers of the previous release during a deploy. It does no CRM
/// work, so it cannot hold a backfill worker.
#[tracing::instrument(skip_all, err, fields(link_id = %link.id))]
pub(super) async fn populate_crm_contact<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &link::Link,
    p: &PopulateCrmContactPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
    let contact = (
        p.contact_email.clone(),
        p.contact_name.clone(),
        p.first_at,
        p.last_at,
    );
    let requests = population_requests(&self_email, [contact], p.is_sent);
    record_crm_population(ctx, link.id, &requests).await
}

/// Records population requests in the ledger; a failure is retried with the
/// operation that implied them.
pub(super) async fn record_crm_population<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: uuid::Uuid,
    requests: &[PopulateCrmContactPayload],
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    if requests.is_empty() {
        return Ok(());
    }
    ctx.repository
        .request_crm_population(link_id, requests)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to record CRM population requests"),
            })
        })
}
