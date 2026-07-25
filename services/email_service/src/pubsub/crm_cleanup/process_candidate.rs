use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use crm::domain::service::CrmService;
use email_db_client::crm_cleanup::candidates;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// Processes one cleanup candidate: claims (deletes) the candidate row, then
/// depopulates the CRM contact if the link no longer has any message (sent or
/// received) involving `contact_email`.
///
/// The claim happens *before* the gate check so that a message delete landing
/// mid-processing re-inserts a fresh candidate for the next nightly run
/// instead of being swallowed. We proceed even when the row is already gone —
/// a redelivery after a mid-processing failure must still run the gate, and a
/// duplicate dispatch just performs one redundant (cheap) check.
///
/// The gate runs outside the CRM crate's advisory lock, so a brand-new sent
/// message landing between the check and the cascade could see a transient
/// deleted state; the populate path on that new message re-creates the rows.
#[tracing::instrument(skip(ctx), err, fields(link_id = %link_id, contact_email = %contact_email))]
pub async fn process_candidate(
    ctx: &CrmCleanupContext,
    link_id: Uuid,
    contact_email: &str,
) -> Result<(), ProcessingError> {
    let claimed = candidates::claim_candidate(&ctx.db, link_id, contact_email)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to claim crm cleanup candidate"),
            })
        })?;

    if !claimed {
        tracing::debug!("Candidate row already claimed (duplicate dispatch or redelivery)");
    }

    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Link deleted since the candidate was written; its CRM sources are
            // torn down by the link-deletion flow.
            tracing::debug!("Link no longer exists; skipping CRM cleanup");
            return Ok(());
        }
        Err(e) => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch link for crm cleanup"),
            }));
        }
    };

    let team_id = ctx
        .crm_service
        .get_team_id_for_user(&link.macro_id.to_string())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to look up team for link.macro_id"),
            })
        })?;

    let Some(team_id) = team_id else {
        tracing::debug!("User has no team; skipping CRM cleanup");
        return Ok(());
    };

    let still_has_any =
        email_db_client::contacts::get::link_has_any_message_with(&ctx.db, link.id, contact_email)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to check remaining messages with contact"),
                })
            })?;

    if still_has_any {
        tracing::debug!(
            "Link still has messages with contact (sent or received); skipping depopulation"
        );
        return Ok(());
    }

    ctx.crm_service
        .depopulate_contact(&team_id, &link.id, contact_email)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to depopulate CRM contact"),
            })
        })?;

    Ok(())
}
