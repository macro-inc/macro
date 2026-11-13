use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
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
#[tracing::instrument(skip(ctx, payload), err, fields(team_id = %payload.team_id))]
pub(super) async fn depopulate_crm_for_user<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    payload: &DepopulateCrmForUserPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let macro_id_str = payload.macro_id.0.as_ref();
    // Must resolve the same link `populate_crm_for_user` seeded from — the
    // inbox whose address matches the macro_id email — so teardown targets
    // the link that was actually populated.
    let email_address = payload.macro_id.email_str();

    let link = ctx
        .repository
        .link_by_email(macro_id_str, email_address)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch link by macro_id and email_address"),
            })
        })?;

    let Some(link) = link else {
        tracing::debug!("User has no email link; skipping CRM teardown");
        return Ok(());
    };

    ctx.crm
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
