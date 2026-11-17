use super::crm_contact::record_crm_population;
use super::email_api_error::map_email_api_error;
use super::metadata::map_db_error;
use super::*;
use crate::domain::crm_population::message_requests;
use crate::domain::mailbox::inbox_sync::resync_snapshot;
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
    request_crm_population(ctx, link, std::slice::from_ref(&message)).await?;

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

/// Records the CRM population requests the messages imply: recipients of
/// sent mail, senders of received mail, nothing for drafts. Needs no database
/// row, so it can run before the messages are written; a population reads the
/// stored mail once its request has settled.
pub(super) async fn request_crm_population<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &link::Link,
    messages: &[Message],
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let requests: Vec<_> = messages
        .iter()
        .flat_map(|message| message_requests(link, message))
        .collect();
    record_crm_population(ctx, link.id, &requests).await
}
