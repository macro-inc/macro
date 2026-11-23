use super::email_api_error::map_email_api_error;
use super::metadata::map_db_error;
use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::mailbox::inbox_sync::{
    CrmContactRecipient, enqueue_crm_contacts as enqueue_normalized_contacts, resync_snapshot,
};
use email_api_client::domain::models::CalendarPart;
use models_email::service::{
    backfill::*,
    link,
    message::Message,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// Backfills one message of a thread whose messages were enqueued one by one.
///
/// BackfillThread now writes a thread's messages itself; this step only drains
/// BackfillMessage operations enqueued before that. Creates a message object in
/// the database. If the message is the last message in the thread to be
/// processed, it sends an UpdateThreadMetadata message for the thread.
#[tracing::instrument(skip(ctx))]
pub(super) async fn backfill_message<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &JobScopedPayload<BackfillMessagePayload>,
    link: &link::Link,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let p = &scope.payload;
    // Sync may have stored the message since the backfill listed it; a
    // re-sync must not undo a label write made meanwhile.
    let stored = ctx
        .repository
        .stored_message(link.id, &p.message_provider_id)
        .await
        .map_err(|e| map_db_error(e, "Failed to look up the stored message"))?;
    let fetch = Box::pin(ctx.gmail.message(link.id, &p.message_provider_id));
    let (fetched, resync) = match &stored {
        Some(stored) => {
            let (fetched, snapshot) = resync_snapshot(&ctx.repository, stored.db_id, fetch)
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

    ctx.effects.prepare_message(&mut message).await;

    // Insert the message while holding one of the fleet's backfill write slots.
    let slot = admit_write_slot(ctx.effects.acquire_write().await)?;
    let inserted = slot
        .hold(
            ctx.repository
                .insert_message(link.id, p.thread_db_id, &mut message, resync.as_ref()),
        )
        .await;
    inserted.map_err(|e| map_db_error(e, "Failed to insert final message into database"))?;

    save_invitations(ctx, link, &message, &fetched.calendar_parts).await;
    enqueue_crm_contacts(ctx, link, &message).await?;

    // Handle all success-related operations
    super::counters::incr_completed_messages(ctx, link, scope.job_id, p).await
}

/// Saves the calendar invitations a written backfill message carries. Best
/// effort: a failure is logged, as invitation extraction always has been.
pub(super) async fn save_invitations<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &link::Link,
    message: &Message,
    calendar_parts: &[CalendarPart],
) where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let provider_id = message.provider_id.as_deref().unwrap_or_default();
    if !message.is_draft && !calendar_parts.is_empty() {
        match ctx
            .repository
            .invitation_message(link.id, provider_id)
            .await
        {
            Ok((message_id, _)) => {
                ctx.effects
                    .save_invitations(link.id, provider_id, message_id, calendar_parts)
                    .await;
            }
            Err(error) => {
                let error = error.source;
                tracing::warn!(error = ?error, "invitation extraction skipped");
            }
        }
    }
}

/// Enqueues the CRM contact updates a backfill message implies. Needs no
/// database row, so it can run before the message is written.
pub(super) async fn enqueue_crm_contacts<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &link::Link,
    message: &Message,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
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
            enqueue_normalized_contacts(
                link.id,
                &self_email,
                recipients,
                message.is_sent,
                |message| async {
                    ctx.queue
                        .enqueue(message)
                        .await
                        .map_err(ConnectionSourceError::into_original)
                },
            )
            .await?;
        }
    }

    Ok(())
}
