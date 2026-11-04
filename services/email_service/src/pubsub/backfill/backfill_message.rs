use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::{CrmContactRecipient, enqueue_populate_crm_contacts};
use email_api_client::domain::models::CalendarPart;
use models_email::email::service::backfill::{BackfillMessagePayload, JobScopedPayload};
use models_email::email::service::link;
use models_email::email::service::message::Message;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Legacy per-message deliveries cannot establish a thread's complete set of
/// work after counter loss. Defer them until the parent job is recovered.
#[tracing::instrument(skip(_ctx, scope, _link), fields(job_id = %scope.job_id), err)]
pub async fn backfill_message(
    _ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillMessagePayload>,
    _link: &link::Link,
) -> Result<(), ProcessingError> {
    Err(ProcessingError::Retryable(DetailedError {
        reason: FailureReason::BackfillProgressNeedsRecovery,
        source: anyhow::anyhow!("legacy per-message import requires a fresh recovery sweep"),
    }))
}

/// Saves the calendar invitations a written backfill message carries. Best
/// effort: a failure is logged, as invitation extraction always has been.
pub(super) async fn save_invitations(
    ctx: &PubSubContext,
    link: &link::Link,
    message: &Message,
    calendar_parts: &[CalendarPart],
) {
    let provider_id = message.provider_id.as_deref().unwrap_or_default();
    if !message.is_draft && !calendar_parts.is_empty() {
        match email_db_client::messages::get::get_message_and_thread_id_by_provider_id(
            &ctx.db,
            link.id,
            provider_id,
        )
        .await
        {
            Ok((message_id, _)) => {
                crate::pubsub::invitation_extraction::save_discovered(
                    ctx,
                    link.id,
                    provider_id,
                    message_id,
                    calendar_parts,
                )
                .await;
            }
            Err(error) => tracing::warn!(error = ?error, "invitation extraction skipped"),
        }
    }
}

/// Enqueues the CRM contact updates a backfill message implies. Needs no
/// database row, so it can run before the message is written.
pub(super) async fn enqueue_crm_contacts(
    ctx: &PubSubContext,
    link: &link::Link,
    message: &Message,
) -> Result<(), ProcessingError> {
    // Fan out a PopulateCrmContact job per address involved in the
    // message — every non-draft message contributes, in both
    // directions. Sent: enumerate to/cc/bcc (recipients the team
    // emailed). Received: enumerate `from` (external sender). The
    // consumer branches on `is_sent` to decide whether a new
    // `crm_companies` row may be inserted — received-direction
    // populates only ever touch already-tracked companies.
    //
    // Drafts are skipped: their from = the user, their to/cc/bcc may
    // not be finalized, and they don't represent real correspondence.
    //
    // ON CONFLICT DO NOTHING on the consumer side keeps duplicate
    // enqueues (e.g. retried backfill_message attempts) harmless. The
    // display name from the gmail header is threaded through so the
    // consumer doesn't have to re-query email_contacts.
    // `internal_date_ts` is passed as `message_at`; `contact_id` is
    // `None` here because we already carry `message_at` and the
    // contact row may not exist yet at producer time.
    if !message.is_draft {
        let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
        // Single message → single timestamp covers both endpoints. The
        // consumer's stored-value merge converges as more messages come
        // in. `Utc::now()` fallback when Gmail returned no
        // internal_date_ts.
        let at = message.internal_date_ts.unwrap_or_else(chrono::Utc::now);
        let recipients: Vec<CrmContactRecipient> = if message.is_sent {
            message
                .to
                .iter()
                .chain(&message.cc)
                .chain(&message.bcc)
                .map(|c| (c.email.clone(), c.name.clone(), at, at))
                .collect()
        } else {
            message
                .from
                .iter()
                .map(|c| (c.email.clone(), c.name.clone(), at, at))
                .collect()
        };
        if !recipients.is_empty() {
            enqueue_populate_crm_contacts(ctx, link.id, &self_email, recipients, message.is_sent)
                .await?;
        }
    }

    Ok(())
}
