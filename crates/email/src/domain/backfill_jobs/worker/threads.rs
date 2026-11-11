use super::email_api_error::map_email_api_error;
use super::message::{enqueue_crm_contacts, save_invitations};
use super::metadata::map_db_error;
use super::*;
use crate::domain::mailbox::inbox_sync::InboxSyncPreparation;
use email_api_client::domain::models::{CalendarPart, MessageWithCalendarParts};
use models_email::service::{backfill::*, link, message::Message, pubsub::ProcessingError};
/// This step is invoked by ListThreads for each thread being backfilled.
/// Reads the whole thread from the provider at once and writes the thread with
/// all of its messages in one transaction, holding one of the fleet's backfill
/// write slots, then hands the thread to its attachment and metadata steps.
#[tracing::instrument(skip(ctx), fields(message_count))]
pub(super) async fn backfill_thread<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let p = &scope.payload;
    let thread_provider_id = p.thread_provider_id.clone();

    let existing_threads = ctx
        .repository
        .existing_threads(link.id, &thread_provider_id)
        .await
        .map_err(|e| {
            map_db_error(
                e,
                format!("DB check for existing thread {} failed", thread_provider_id),
            )
        })?;

    // If the thread already exists: recovery jobs refresh it (backfilling any
    // messages that arrived in the sync gap), other jobs skip it and update
    // redis counters.
    if let Some(existing_thread_db_id) = existing_threads.get(&thread_provider_id) {
        if p.refresh_existing {
            return refresh_existing_thread(ctx, scope, link, *existing_thread_db_id).await;
        }
        ctx.legacy.completed_thread(link, scope.job_id).await?;
        return Ok(());
    }

    let fetched = fetch_thread(ctx, link, &thread_provider_id).await?;
    let (mut messages, calendar_parts) = prepare_messages(&ctx.effects, fetched).await;

    // The priority pass and the normal sweep both enqueue a thread, and both
    // copies can pass the check above while they wait for Gmail. Only the copy
    // that inserts the thread finishes it; the other just counts it as done.
    let slot = admit_write_slot(ctx.effects.acquire_write().await)?;
    let inserted = slot
        .hold(async {
            enqueue_threads_crm_contacts(ctx, link, &messages).await?;
            ctx.repository
                .insert_thread(link.id, &thread_provider_id, &mut messages)
                .await
                .map_err(|e| {
                    map_db_error(e, format!("Failed to insert thread {}", thread_provider_id))
                })
        })
        .await?;
    let Some((thread_db_id, skipped)) = inserted else {
        return ctx.legacy.completed_thread(link, scope.job_id).await;
    };

    finish_written_thread(
        ctx,
        scope,
        link,
        thread_db_id,
        &messages,
        &calendar_parts,
        &skipped,
    )
    .await
}

/// Recovery-job path for a thread that is already in the database: read the
/// provider's thread and write only the messages we are missing, so replies
/// that arrived during a sync gap are recovered.
///
/// Job accounting matches the fresh-thread path: with nothing missing the
/// thread completes immediately (like the skip path); otherwise its metadata
/// step completes it.
async fn refresh_existing_thread<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
    thread_db_id: uuid::Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let p = &scope.payload;
    let fetched = fetch_thread(ctx, link, &p.thread_provider_id).await?;

    let provider_ids: Vec<String> = fetched
        .iter()
        .filter_map(|fetched| fetched.message.provider_id.clone())
        .collect();
    let existing_message_ids = ctx
        .repository
        .existing_messages(link.id, &provider_ids)
        .await
        .map_err(|e| {
            map_db_error(
                e,
                format!(
                    "DB check for existing messages of thread {} failed",
                    p.thread_provider_id
                ),
            )
        })?;

    let missing: Vec<MessageWithCalendarParts> = fetched
        .into_iter()
        .filter(|fetched| {
            fetched
                .message
                .provider_id
                .as_ref()
                .is_some_and(|id| !existing_message_ids.contains(id))
        })
        .collect();
    if missing.is_empty() {
        return ctx.legacy.completed_thread(link, scope.job_id).await;
    }

    let (mut messages, calendar_parts) = prepare_messages(&ctx.effects, missing).await;
    let slot = admit_write_slot(ctx.effects.acquire_write().await)?;
    let skipped = slot
        .hold(async {
            enqueue_threads_crm_contacts(ctx, link, &messages).await?;
            ctx.repository
                .insert_messages(link.id, thread_db_id, &mut messages)
                .await
                .map_err(|e| {
                    map_db_error(
                        e,
                        format!(
                            "Failed to insert missing messages of thread {}",
                            p.thread_provider_id
                        ),
                    )
                })
        })
        .await?;

    finish_written_thread(
        ctx,
        scope,
        link,
        thread_db_id,
        &messages,
        &calendar_parts,
        &skipped,
    )
    .await
}

/// Reads every message of the provider thread, with its calendar parts.
async fn fetch_thread<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    link: &link::Link,
    thread_provider_id: &str,
) -> Result<Vec<MessageWithCalendarParts>, ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let fetched = ctx
        .gmail
        .thread(link.id, thread_provider_id)
        .await
        .map_err(|error| map_email_api_error(error, "Failed to get provider thread"))?;
    tracing::Span::current().record("message_count", fetched.len());
    Ok(fetched)
}

/// Cleans each message for insertion, keeping its calendar parts at the same index.
async fn prepare_messages<E: InboxSyncPreparation>(
    effects: &E,
    fetched: Vec<MessageWithCalendarParts>,
) -> (Vec<Message>, Vec<Vec<CalendarPart>>) {
    let mut messages = Vec::with_capacity(fetched.len());
    let mut calendar_parts = Vec::with_capacity(fetched.len());
    for MessageWithCalendarParts {
        mut message,
        calendar_parts: parts,
    } in fetched
    {
        effects.prepare_message(&mut message).await;
        messages.push(message);
        calendar_parts.push(parts);
    }
    (messages, calendar_parts)
}

/// Enqueues the CRM contact updates of every message in the thread. This runs
/// just before the thread is written, while a failure can still be retried:
/// after the commit a retry would skip the thread. It runs once a write slot is
/// held, so an operation deferred for a busy slot doesn't repeat it each time.
/// The rare duplicate from a retried write is harmless.
async fn enqueue_threads_crm_contacts<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    link: &link::Link,
    messages: &[Message],
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    for message in messages {
        enqueue_crm_contacts(ctx, link, message).await?;
    }
    Ok(())
}

/// Finishes a thread whose messages are committed.
///
/// A retried BackfillThread finds the thread written and skips it, so nothing
/// here may ask for a retry. Messages the write skipped are logged. The
/// invitation and attachment fan-outs only log their failures; the metadata
/// step goes last and is the only one that can fail the operation, as a
/// non-retryable error that counts the thread once.
async fn finish_written_thread<R, G, Q, E, C, L>(
    ctx: &BackfillService<R, G, Q, E, C, L>,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
    thread_db_id: uuid::Uuid,
    messages: &[Message],
    calendar_parts: &[Vec<CalendarPart>],
    skipped: &[SkippedBackfillMessage],
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
    L: LegacyBackfill,
{
    let thread_provider_id = &scope.payload.thread_provider_id;
    for SkippedBackfillMessage { index, error } in skipped {
        tracing::warn!(
            error = ?error,
            %thread_provider_id,
            message_id = messages[*index].provider_id.as_deref().unwrap_or_default(),
            "Skipped a backfilled message that cannot be stored"
        );
    }
    for (index, (message, parts)) in messages.iter().zip(calendar_parts).enumerate() {
        if !skipped.iter().any(|skipped| skipped.index == index) {
            save_invitations(ctx, link, message, parts).await;
        }
    }
    if let Err(error) = ctx
        .legacy
        .thread_attachments(link, scope.job_id, thread_db_id)
        .await
    {
        tracing::warn!(error = ?error, %thread_provider_id, "Skipped a backfilled thread's attachment uploads");
    }
    ctx.legacy
        .enqueue_metadata(link, scope.job_id, thread_provider_id, thread_db_id)
        .await
}
