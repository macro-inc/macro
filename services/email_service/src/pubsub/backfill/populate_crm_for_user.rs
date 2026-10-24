use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::enqueue_populate_crm_contacts;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::PopulateCrmForUserPayload;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Seeds the team's CRM tables with every contact the user has sent email
/// to in the past. Triggered when a user is added to a team — the user only
/// has their macro_id at this point, so this handler resolves the user's owned
/// inboxes and team itself, then fans out one `PopulateCrmContact` job per
/// distinct contact on each owned inbox.
///
/// No-ops (acks the message) when the user has no owned email link or no team
/// membership. The downstream `PopulateCrmContact` consumer is idempotent
/// and re-checks the team membership + per-domain killswitch, so racing
/// removals between fan-out and consumption are safe.
#[tracing::instrument(skip(ctx), err, fields(macro_id = %payload.macro_id))]
pub async fn populate_crm_for_user(
    ctx: &PubSubContext,
    payload: &PopulateCrmForUserPayload,
) -> Result<(), ProcessingError> {
    let macro_id_str = payload.macro_id.0.as_ref();

    // `fetch_inboxes_for_macro_id` includes delegated/shared inboxes. CRM
    // backfill should cover every inbox owned by this macro_id, but it must not
    // seed CRM data from inboxes that are only delegated to the user.
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
        tracing::debug!("User has no owned email link; skipping CRM fan-out");
        return Ok(());
    }

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

    for link in links {
        let self_email = link.email_address.0.as_ref().to_ascii_lowercase();

        // The by_link queries aggregate MIN/MAX of `internal_date_ts` per
        // contact, so each fan-out job carries the contact's full known
        // activity range. The consumer stamps `first_interaction` /
        // `last_interaction` directly from those endpoints.
        //
        // Two fan-outs: sent recipients (`is_sent=true`, may create new
        // `crm_companies` rows), then received senders (`is_sent=false`,
        // only updates already-tracked rows). Sent first so received-pass
        // contacts at brand-new companies can also land. Both passes are
        // idempotent.
        let sent_recipients =
            email_db_client::contacts::get::fetch_sent_message_recipient_contacts_by_link(
                &ctx.db, link.id,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch sent-message recipients"),
                })
            })?;

        enqueue_populate_crm_contacts(ctx, link.id, &self_email, sent_recipients, true).await?;

        let received_senders =
            email_db_client::contacts::get::fetch_received_sender_contacts_by_link(
                &ctx.db, link.id,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch received-message senders"),
                })
            })?;

        enqueue_populate_crm_contacts(ctx, link.id, &self_email, received_senders, false).await?;
    }

    Ok(())
}
