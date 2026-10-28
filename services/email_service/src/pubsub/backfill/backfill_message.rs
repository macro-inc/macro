use crate::pubsub::backfill::db_error::map_db_error;
use crate::pubsub::backfill::email_api_error::map_email_api_error;
use crate::pubsub::backfill::{increment_counters, write_slot};
use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::operations::pending_labels;
use crate::pubsub::util::{CrmContactRecipient, enqueue_populate_crm_contacts};
use crate::util::process_pre_insert::process_message_pre_insert;
use email_api_client::domain::models::CalendarPart;
use models_email::email::service::backfill::{BackfillMessagePayload, JobScopedPayload};
use models_email::email::service::link;
use models_email::email::service::message::Message;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Backfills one message of a thread whose messages were enqueued one by one.
///
/// BackfillThread now writes a thread's messages itself; this step only drains
/// BackfillMessage operations enqueued before that. Creates a message object in
/// the database. If the message is the last message in the thread to be
/// processed, it sends an UpdateThreadMetadata message for the thread.
#[tracing::instrument(skip(ctx))]
pub async fn backfill_message(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillMessagePayload>,
    link: &link::Link,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;
    // Sync may have stored the message since the backfill listed it; a
    // re-sync must not undo a label write made meanwhile.
    let stored =
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &ctx.db,
            &p.message_provider_id,
            &link.id,
        )
        .await
        .map_err(|e| map_db_error(e, "Failed to look up the stored message"))?;
    let fetch = Box::pin(ctx.email_api.get_message(link.id, &p.message_provider_id));
    let (fetched, resync) = match &stored {
        Some(stored) => {
            let (fetched, snapshot) = pending_labels::resync_around(&ctx.db, stored.db_id, fetch)
                .await
                .map_err(|e| map_db_error(e, "Failed to read the stored message"))?;
            (fetched, Some(snapshot))
        }
        None => (fetch.await, None),
    };
    let fetched = fetched
        .map_err(|error| map_email_api_error(error, "Failed to get provider message"))?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::MessageNotFoundInProvider,
                source: anyhow::anyhow!("Message {} not found in provider", p.message_provider_id),
            })
        })?;
    let mut message = fetched.message;

    process_message_pre_insert(&mut message).await;

    // Insert the message while holding one of the fleet's backfill write slots.
    let slot = write_slot::acquire(ctx).await?;
    let inserted = slot
        .hold(email_db_client::messages::insert::insert_message(
            &ctx.db,
            p.thread_db_id,
            &mut message,
            link.id,
            // we update the thread metadata once all messages in the thread have been backfilled
            false,
            resync.as_ref(),
        ))
        .await;
    inserted.map_err(|e| map_db_error(e, "Failed to insert final message into database"))?;

    save_invitations(ctx, link, &message, &fetched.calendar_parts).await;
    enqueue_crm_contacts(ctx, link, &message).await?;

    // Handle all success-related operations
    increment_counters::incr_completed_messages(ctx, link, scope.job_id, p).await
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
