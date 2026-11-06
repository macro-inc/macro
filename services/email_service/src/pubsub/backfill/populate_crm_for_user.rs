use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::enqueue_populate_crm_contacts;
use crm::domain::email_privacy::EmailPrivacyService;
use crm::domain::service::CrmService;
use models_email::email::service::backfill::PopulateCrmForUserPayload;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Fans out historical contacts only for the user's explicitly consented
/// primary mailbox. Consent and exclusions are rechecked by each contact job.
///
/// Stale requests after withdrawal, account switching, or team removal no-op.
#[tracing::instrument(skip_all, err, fields(team_id, link_id))]
pub async fn populate_crm_for_user(
    ctx: &PubSubContext,
    payload: &PopulateCrmForUserPayload,
) -> Result<(), ProcessingError> {
    let macro_id_str = payload.macro_id.0.as_ref();
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

    let Some(team_id) = team_id else {
        tracing::debug!("User has no team; skipping CRM fan-out");
        return Ok(());
    };

    let mailbox = ctx
        .crm_service
        .contribution_mailbox(team_id, macro_id_str)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::from(e).context("Failed to resolve CRM email consent"),
            })
        })?;
    let Some(mailbox) = mailbox else {
        tracing::debug!("User has no consented mailbox; skipping CRM fan-out");
        return Ok(());
    };

    tracing::Span::current().record("team_id", tracing::field::display(team_id));
    tracing::Span::current().record("link_id", tracing::field::display(mailbox.link_id));
    let self_email = mailbox.email_address.to_ascii_lowercase();

    // The by_link queries aggregate MIN/MAX of `internal_date_ts` per
    // contact, so each fan-out job carries the contact's full known
    // activity range. The consumer recomputes the eligible range from stored
    // messages so stale jobs and mixed-domain threads cannot bypass blocks.
    //
    // Two fan-outs: sent recipients (`is_sent=true`, may create new
    // `crm_companies` rows), then received senders (`is_sent=false`,
    // only updates already-tracked rows). Sent first so received-pass
    // contacts at brand-new companies can also land. Both passes are
    // idempotent.
    let sent_recipients =
        email_db_client::contacts::get::fetch_sent_message_recipient_contacts_by_link(
            &ctx.db,
            mailbox.link_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch sent-message recipients"),
            })
        })?;

    enqueue_populate_crm_contacts(ctx, mailbox.link_id, &self_email, sent_recipients, true).await?;

    let received_senders = email_db_client::contacts::get::fetch_received_sender_contacts_by_link(
        &ctx.db,
        mailbox.link_id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch received-message senders"),
        })
    })?;

    enqueue_populate_crm_contacts(ctx, mailbox.link_id, &self_email, received_senders, false).await
}
