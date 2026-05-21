use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::enqueue_populate_crm_contacts;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::PopulateCrmForUserPayload;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Seeds the team's CRM tables with every contact the user has sent email
/// to in the past. Triggered when a user is added to a team — the user only
/// has their macro_id at this point, so this handler resolves the link and
/// team itself, then fans out one `PopulateCrmContact` job per distinct
/// recipient of a sent message on that link.
///
/// No-ops (acks the message) when the user has no email link or no team
/// membership. The downstream `PopulateCrmContact` consumer is idempotent
/// and re-checks the team membership + per-domain killswitch, so racing
/// removals between fan-out and consumption are safe.
#[tracing::instrument(skip(ctx), err, fields(macro_id = %payload.macro_id))]
pub async fn populate_crm_for_user(
    ctx: &PubSubContext,
    payload: &PopulateCrmForUserPayload,
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
        tracing::debug!("User has no email link; skipping CRM fan-out");
        return Ok(());
    };

    let team_id = ctx
        .crm_service
        .get_team_id_for_user(macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to look up team for macro_id"),
            })
        })?;

    if team_id.is_none() {
        tracing::debug!("User has no team; skipping CRM fan-out");
        return Ok(());
    }

    let self_email = link.email_address.0.as_ref().to_ascii_lowercase();

    // Pull every distinct recipient (email + display name) from sent
    // messages on this link. Mirrors what backfill_message would have
    // produced if the per-message fan-out had been running when these
    // messages were first backfilled — including the name from
    // email_contacts so the consumer can set crm_contacts.name without
    // its own round-trip.
    let recipients = email_db_client::contacts::get::fetch_sent_message_recipient_contacts_by_link(
        &ctx.db, link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch sent-message recipients"),
        })
    })?;

    enqueue_populate_crm_contacts(ctx, link.id, &self_email, recipients).await
}
