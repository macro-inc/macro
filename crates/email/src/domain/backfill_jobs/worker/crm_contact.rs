use super::*;
use ::crm::domain::model::CrmError;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// Records a CRM interaction for one `(link, contact_email)` —
/// possibly inserting new `crm_companies` / `crm_contacts` /
/// `crm_contact_sources` rows.
///
/// Fanned out one-per-address from `backfill_message`, `upsert_message`,
/// and `populate_crm_for_user`. Every non-draft message contributes:
/// sent-direction populates fan out per to/cc/bcc recipient and may
/// insert new company rows; received-direction populates fan out for
/// the sender and only touch already-tracked companies. The consumer
/// resolves the team for the link (no-op if no team), then delegates
/// to [`crm::domain::service::CrmService::populate_contact`] which
/// applies the full insert / update matrix.
///
/// `first_at` / `last_at` come from the producer pre-computed. Per-
/// message paths set both to the message's `internal_date_ts` (with
/// `Utc::now()` fallback at the producer when Gmail returned none).
/// The historical seed aggregates MIN/MAX per contact in SQL.
///
/// Each population holds one of its team's CRM population slots, so one
/// team's consent backfill can't occupy a database connection per worker.
/// A refused slot, or a population that timed out waiting for a CRM lock,
/// is deferred like a busy backfill write instead of spending a delivery.
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
    let macro_user_id = link.macro_id.to_string();

    let team_id = ctx
        .crm
        .get_team_id_for_user(&macro_user_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to look up team for link.macro_id"),
            })
        })?;

    let Some(team_id) = team_id else {
        return Ok(());
    };

    let slot = super::admit_write_slot(ctx.effects.acquire_crm(team_id).await)?;
    slot.hold(ctx.crm.populate_contact(&team_id, link, p))
        .await
        .map_err(|e| {
            let reason = match e {
                CrmError::Contended => FailureReason::BackfillWritesBusy,
                _ => FailureReason::DatabaseQueryFailed,
            };
            ProcessingError::Retryable(DetailedError {
                reason,
                source: anyhow::Error::from(e).context("Failed to populate CRM contact"),
            })
        })?;

    Ok(())
}
