use crate::pubsub::context::PubSubContext;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::DepopulateCrmForUserPayload;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Removes every CRM source row owned by the user's email link within
/// `payload.team_id`, plus the team's contact / company rows orphaned
/// as a result (preserving companies with `email_sync = false`).
///
/// Triggered when a user is removed from a team. Counterpart to
/// [`populate_crm_for_user`]. Unlike the per-message
/// `DepopulateCrmContact` step, this bypasses the per-recipient
/// `link_has_sent_message_to` pre-check: the user's sent messages still
/// exist after team removal, but the team no longer cares about the
/// contacts on them — so we tear down based on link ownership inside
/// the team, not message presence.
///
/// No-ops (acks the message) when the user has no email link.
/// Team-deletion does NOT go through this path; the
/// `crm_companies.team_id` FK cascade handles it in macrodb.
#[tracing::instrument(skip(ctx), err, fields(macro_id = %payload.macro_id, team_id = %payload.team_id))]
pub async fn depopulate_crm_for_user(
    ctx: &PubSubContext,
    payload: &DepopulateCrmForUserPayload,
) -> Result<(), ProcessingError> {
    let macro_id_str = payload.macro_id.0.as_ref();

    let link = email_db_client::links::get::fetch_link_by_macro_id(&ctx.db, macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch link by macro_id"),
            })
        })?;

    let Some(link) = link else {
        tracing::debug!("User has no email link; skipping CRM teardown");
        return Ok(());
    };

    ctx.crm_service
        .depopulate_link_in_team(&payload.team_id, &link.id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to depopulate CRM for link in team"),
            })
        })?;

    Ok(())
}
