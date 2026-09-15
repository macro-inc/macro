use crate::pubsub::context::PubSubContext;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::DepopulateCrmForUserPayload;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Removes every CRM source row owned by the user's email links within
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
/// No-ops (acks the message) when the user has no owned email link.
/// Team-deletion does NOT go through this path; the
/// `crm_companies.team_id` FK cascade handles it in macrodb.
#[tracing::instrument(skip(ctx), err, fields(macro_id = %payload.macro_id, team_id = %payload.team_id))]
pub async fn depopulate_crm_for_user(
    ctx: &PubSubContext,
    payload: &DepopulateCrmForUserPayload,
) -> Result<(), ProcessingError> {
    let macro_id_str = payload.macro_id.0.as_ref();

    // Mirror populate_crm_for_user exactly: fetch all accessible inboxes, then
    // keep only links owned by this macro_id. Delegated/shared inboxes belong
    // to another macro user and must not be torn down here.
    let mut links = email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch inboxes for macro_id"),
            })
        })?;
    links.retain(|link| link.macro_id.as_ref() == macro_id_str);

    if links.is_empty() {
        tracing::debug!("User has no owned email link; skipping CRM teardown");
        return Ok(());
    }

    for link in links {
        ctx.crm_service
            .depopulate_link_in_team(&payload.team_id, &link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: anyhow::Error::from(e)
                        .context("Failed to depopulate CRM for link in team"),
                })
            })?;
    }

    Ok(())
}
