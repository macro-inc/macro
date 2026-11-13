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
/// is deferred with the CRM refusal backoff instead of spending a delivery.
/// The slot is refused without waiting: while one team's backlog holds its
/// slots, waiting would park a shared worker on every one of its messages.
/// A population the CRM rejects outright, such as a malformed address, is
/// dropped instead of retried.
///
/// The dispatcher logs each outcome with its reason and error chain, so the
/// span records no error event of its own: a refusal is not a failure.
#[tracing::instrument(skip_all, fields(link_id = %link.id))]
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

    let slot = match ctx.effects.acquire_crm(team_id).await {
        Ok(Some(slot)) => slot,
        Ok(None) => {
            return Err(crm_population_busy(anyhow::anyhow!(
                "every CRM population slot of team {team_id} is taken"
            )));
        }
        Err(error) => {
            return Err(crm_population_busy(
                error.context("CRM population slots are unavailable"),
            ));
        }
    };
    slot.hold(ctx.crm.populate_contact(&team_id, link, p))
        .await
        .map_err(population_error)?;

    Ok(())
}

fn crm_population_busy(source: anyhow::Error) -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::CrmPopulationBusy,
        source,
    })
}

fn population_error(error: CrmError) -> ProcessingError {
    let retryable = match error {
        CrmError::Contended => Some(FailureReason::CrmPopulationBusy),
        CrmError::StorageLayerError(_) => Some(FailureReason::DatabaseQueryFailed),
        _ => None,
    };
    let detail = |reason| DetailedError {
        reason,
        source: anyhow::Error::from(error).context("Failed to populate CRM contact"),
    };
    match retryable {
        Some(reason) => ProcessingError::Retryable(detail(reason)),
        None => ProcessingError::NonRetryable(detail(FailureReason::InvalidData)),
    }
}
