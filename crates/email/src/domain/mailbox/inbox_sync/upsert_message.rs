use super::*;
use crate::domain::events::{
    EmailEventOrigin, MessageDraftSyncedMetadata, MessageReceivedMetadata, MessageSentMetadata,
};
use email_api_client::domain::models::{EmailApiError, MessageWithCalendarParts};
use email_utils::dedupe_emails;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::db::address::EmailRecipientType;
use models_email::gmail::inbox_sync::{InboxSyncOperation, UpsertMessagePayload};
use models_email::service::attachment::{
    Attachment, AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use models_email::service::{
    link,
    message::{Message, SimpleMessage, is_inbound, is_outbound, is_spam_or_trash},
    thread::Thread,
};
use std::collections::HashSet;
use uuid::Uuid;
mod attachments;
mod contacts;
mod notifications;
mod persistence;
#[cfg(test)]
mod test;
use attachments::handle_attachment_upload;
pub use attachments::upload_claimed_attachments;
use contacts::{CrmContactRecipient, enqueue_populate_crm_contacts, handle_contacts_sync};
use notifications::notify_for_new_message;
use persistence::fetch_and_insert_thread;
pub use persistence::process_and_insert_message;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageSyncEventKind {
    DraftSynced,
    Received,
    Sent,
}

fn select_message_sync_event(
    existing_message_was_draft: Option<bool>,
    is_draft: bool,
    is_sent: bool,
) -> Option<MessageSyncEventKind> {
    if is_draft {
        return Some(MessageSyncEventKind::DraftSynced);
    }

    if existing_message_was_draft == Some(true) && is_sent {
        return Some(MessageSyncEventKind::Sent);
    }

    if existing_message_was_draft.is_some() {
        return None;
    }

    if is_sent {
        Some(MessageSyncEventKind::Sent)
    } else {
        Some(MessageSyncEventKind::Received)
    }
}

/// Fetches the message from Gmail, or `None` when Gmail no longer has it.
async fn fetch_provider_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    payload: &UpsertMessagePayload,
) -> result::Result<Option<MessageWithCalendarParts>, ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    match ctx
        .gmail
        .message(link.id, &payload.provider_message_id)
        .await
    {
        Ok(fetched) => Ok(fetched),
        Err(error) => Err(handle_operation_error(
            &ctx.queue,
            ctx.retry_worker,
            link.id,
            InboxSyncOperation::UpsertMessage(payload.clone()),
            error,
        )
        .await),
    }
}

// upsert a message into the db. could be a new message or an existing one that had changes
#[tracing::instrument(skip(ctx))]
pub(super) async fn upsert_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    payload: &UpsertMessagePayload,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    // Snapshot the previous draft state before the upsert. Provider drafts are mutable,
    // and this state distinguishes a draft-to-sent transition from an unchanged message.
    let existing_message = ctx
        .repository
        .message(link.id, &payload.provider_message_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch existing message before provider upsert".to_string()),
            })
        })?;
    let existing_message_was_draft = existing_message.as_ref().map(|message| message.is_draft);
    let message_already_exists = existing_message.is_some();

    let (fetched, resync) = match &existing_message {
        Some(existing) => {
            let (fetched, snapshot) = resync_around(
                &ctx.repository,
                existing.db_id,
                Box::pin(fetch_provider_message(ctx, link, payload)),
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to read the stored message before its re-sync"),
                })
            })?;
            (fetched?, Some(snapshot))
        }
        None => (fetch_provider_message(ctx, link, payload).await?, None),
    };
    let Some(fetched) = fetched else {
        tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
            "Message not found in gmail when attempting to upsert");
        return Ok(());
    };
    let mut message = fetched.message;

    let message_attachment_count = message.attachments.len();

    // will always exist because we just fetched it
    let provider_thread_id = message.provider_thread_id.clone().unwrap();

    let is_sent = message.is_sent;
    let is_spam_or_trash = is_spam_or_trash(&message);

    let sender_email = message
        .from
        .as_ref()
        .map(|from| from.email.clone())
        .filter(|e| !email_utils::is_generic_email(e));

    // deduped list of all non-generic emails the message was sent to
    let recipient_emails = dedupe_emails(
        message
            .to
            .iter()
            .chain(&message.cc)
            .chain(&message.bcc)
            .map(|c| c.email.clone())
            .collect(),
    )
    .into_iter()
    .filter(|e| !email_utils::is_generic_email(e))
    .collect::<Vec<_>>();

    // Snapshot `(email, name, first_at, last_at)` tuples for the CRM
    // populate fan-out below. Captured here (before `message` is moved
    // into `process_and_insert_message`) so the consumer can write
    // `crm_contacts.name` without a separate email_contacts lookup.
    //
    // Single message → single timestamp covers both endpoints; the
    // consumer merges with the stored range over time. Sent: enumerate
    // to/cc/bcc. Received: enumerate `from`. Drafts are skipped — they
    // don't represent real correspondence. No producer-side filtering
    // of addresses — the crm crate is the single source of truth.
    let is_draft = message.is_draft;
    // `Utc::now()` fallback when Gmail returned no internal_date_ts.
    let at = message.internal_date_ts.unwrap_or_else(chrono::Utc::now);
    let crm_recipients: Vec<CrmContactRecipient> = if is_draft {
        Vec::new()
    } else if is_sent {
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

    // Snapshot header-level fields for the macro.email event before
    // `message` is moved into the insert path. Bodies, snippets, and bcc
    // addresses are never published.
    let event_subject = message.subject.clone();
    let event_from = message.from.clone();
    let event_to_emails: Vec<String> = message.to.iter().map(|c| c.email.clone()).collect();
    let event_cc_emails: Vec<String> = message.cc.iter().map(|c| c.email.clone()).collect();
    let event_sent_at = message.sent_at.or(message.internal_date_ts);
    let event_received_at = message.internal_date_ts;

    // determine if message's thread already exists in the database
    let thread_provider_to_db_map = ctx
        .repository
        .thread_ids(link.id, &provider_thread_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to get threads by link id and provider ids".to_string()),
            })
        })?;

    let is_new_thread = !thread_provider_to_db_map.contains_key(&provider_thread_id);

    // if the message's thread doesn't exist in the database, we need to fetch and insert the whole thread.
    // if it does exist in the database, we just need to insert the already fetched message.
    if let Some(thread_db_id) = thread_provider_to_db_map.get(&provider_thread_id) {
        // Retryable: a concurrent delete can drop the thread after the lookup
        // above, and the redelivery then takes the whole-thread branch below.
        process_and_insert_message(
            &ctx.repository,
            &ctx.effects,
            link.id,
            *thread_db_id,
            &mut message,
            resync.as_ref(),
        )
        .await?;
    } else {
        // Propagated verbatim: fetch_and_insert_thread already routed provider
        // errors through handle_operation_error (retry queue vs redelivery),
        // and re-wrapping would double-process rate limits and mislabel
        // permanent failures as retryable.
        fetch_and_insert_thread(ctx, payload, link.id, &provider_thread_id).await?;
    }

    let (message_db_id, thread_db_id) = ctx
        .repository
        .message_ids(link.id, &payload.provider_message_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to get new message db id".to_string()),
            })
        })?;

    // Also runs for a message already saved by a whole-thread fetch, which carries no
    // calendar parts. Saves skip existing components; an attachment-only invitation is
    // downloaded again on a re-sync.
    if !message.is_draft {
        ctx.effects
            .save_invitations(
                link.id,
                &payload.provider_message_id,
                message_db_id,
                &fetched.calendar_parts,
            )
            .await;
    }

    // Publish to the macro.email topic immediately after the committed insert.
    // Drafts publish after every sync because their bodies are mutable. Existing
    // immutable messages remain suppressed except when a previously synced provider
    // draft becomes sent.
    if let Some(event_kind) =
        select_message_sync_event(existing_message_was_draft, is_draft, is_sent)
    {
        let event = match event_kind {
            MessageSyncEventKind::DraftSynced => {
                EmailMacroEvent::message_draft_synced(MessageDraftSyncedMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    message_id: message_db_id,
                    provider_message_id: payload.provider_message_id.clone(),
                    thread_id: thread_db_id,
                    provider_thread_id: provider_thread_id.clone(),
                    is_spam_or_trash,
                })
            }
            MessageSyncEventKind::Received => {
                EmailMacroEvent::message_received(MessageReceivedMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    message_id: message_db_id,
                    provider_message_id: payload.provider_message_id.clone(),
                    thread_id: thread_db_id,
                    provider_thread_id: provider_thread_id.clone(),
                    is_new_thread,
                    subject: event_subject,
                    from_email: event_from.as_ref().map(|contact| contact.email.clone()),
                    from_name: event_from.as_ref().and_then(|contact| contact.name.clone()),
                    to_emails: event_to_emails,
                    attachment_count: message_attachment_count as u32,
                    is_spam_or_trash,
                    received_at: event_received_at,
                })
            }
            MessageSyncEventKind::Sent => EmailMacroEvent::message_sent(MessageSentMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor: None,
                message_id: message_db_id,
                provider_message_id: payload.provider_message_id.clone(),
                thread_id: thread_db_id,
                provider_thread_id: provider_thread_id.clone(),
                subject: event_subject,
                to_emails: event_to_emails,
                cc_emails: event_cc_emails,
                origin: EmailEventOrigin::ProviderSync,
                sent_at: event_sent_at.unwrap_or_else(chrono::Utc::now),
            }),
        };
        publish_email_event(&ctx.effects, &event);
    }

    let refused_upload = handle_attachment_upload(ctx, link, payload, &message.attachments).await?;

    handle_contacts_sync(
        ctx,
        link,
        &recipient_emails,
        sender_email.as_deref(),
        is_sent,
    )
    .await?;

    // Fan out a PopulateCrmContact job per address. Mirrors
    // `backfill_message.rs`: sent → to/cc/bcc, received → from,
    // drafts → skipped. The consumer branches on `is_sent` for the
    // company-insert gate.
    if !crm_recipients.is_empty() {
        let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
        enqueue_populate_crm_contacts(ctx, link.id, &self_email, crm_recipients, is_sent).await?;
    }

    // trigger FE inbox refresh
    ctx.effects
        .refresh(
            link.macro_id.as_ref(),
            InboxSyncRefresh::UpsertMessage(link.id),
        )
        .await;

    // notify downstream services of new messages
    if !message_already_exists {
        notify_for_new_message(
            ctx,
            link,
            &payload.provider_message_id,
            message_db_id,
            thread_db_id,
        )
        .await?;
    }

    // Requeued only after the steps above, which are safe to repeat: the retry
    // finds the message saved, so it doesn't notify again.
    if let Some(error) = refused_upload {
        return Err(handle_operation_error(
            &ctx.queue,
            ctx.retry_worker,
            link.id,
            InboxSyncOperation::UpsertMessage(payload.clone()),
            error,
        )
        .await);
    }

    Ok(())
}

/// Capture stored labels and pending writes around a provider fetch.
pub async fn resync_around<R: InboxSyncImportRepository, T: Send>(
    db: &R,
    message: Uuid,
    read: futures::future::BoxFuture<'_, T>,
) -> anyhow::Result<(T, InboxSyncResync)> {
    let stored_labels = db
        .labels(message)
        .await
        .map_err(ConnectionSourceError::into_original)?
        .into_iter()
        .map(|label| label.provider_label_id)
        .collect();
    let read = super::pending_labels::read_around(db, message, read)
        .await
        .map_err(ConnectionSourceError::into_original)?;
    let pending_labels = read.untrusted_labels();
    Ok((
        read.value,
        InboxSyncResync {
            stored_labels,
            pending_labels,
        },
    ))
}
