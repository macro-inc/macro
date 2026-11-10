use super::*;
use crate::domain::events::MessageDeletedMetadata;
use models_email::gmail::inbox_sync::DeleteMessagePayload;
use models_email::service::link;

// delete user's message from the db
#[tracing::instrument(skip(ctx))]
pub(super) async fn delete_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    payload: &DeleteMessagePayload,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncRepository,
    G: InboxSyncGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher,
{
    let mut tx = ctx.repository.begin_delete().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.into_original().context("Failed to begin transaction"),
        })
    })?;
    // Keep the provider identity and draft lifetime stable through deletion.
    // A completion or Undo that wins the message lock is observed by this lookup;
    // one that loses waits until deletion has been applied or safely deferred.
    let message = match tx
        .message_for_update(link.id, &payload.provider_message_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to get simple message".to_string()),
            })
        })? {
        Some(msg) => msg,
        None => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in Gmail when attempting to delete message");
            return Ok(());
        }
    };

    // Snapshot the addresses that may have contributed CRM source rows
    // for this message so we can tear them down. Both directions can
    // create sources (per the populate path): sent messages →
    // to/cc/bcc recipients, received messages → from (sender). Drafts
    // never reach CRM populate, so they don't need depopulate either.
    let crm_emails: Vec<String> = if message.is_draft {
        Vec::new()
    } else if message.is_sent {
        let recipients = tx.recipients(message.db_id).await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch recipients for deleted message".to_string()),
            })
        })?;
        // No producer-side filtering — the crm crate decides what's
        // depopulatable. Filtering here would create drift with the
        // populate side, which is also unfiltered at the producer.
        recipients
            .into_iter()
            .filter_map(|(contact, _)| contact.email_address)
            .collect()
    } else {
        // Received: the sender is the external party that may have a
        // CRM source row tied to this link.
        let sender = tx.sender(message.db_id).await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch sender for deleted message".to_string()),
            })
        })?;
        sender.into_iter().filter_map(|c| c.email_address).collect()
    };

    let result = async {
        let result = tx.delete(&message).await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to delete message with transaction".to_string()),
            })
        })?;
        // Commit CRM cleanup candidates with the deletion so neither can survive
        // a rollback alone. Deferred deletions retain the message; cleanup's
        // `link_has_any_message_with` pre-check keeps its contacts until removal.
        // Upsert last: the row lock lasts until commit, and every delete of mail
        // with the same contact waits on it.
        if !crm_emails.is_empty() {
            let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
            tx.cleanup_contacts(link.id, &self_email, crm_emails)
                .await?;
        }
        Ok::<MessageDeletion, ProcessingError>(result)
    }
    .await;

    let deletion = tx.complete(result).await?;
    if deletion == MessageDeletion::Deferred {
        tracing::info!(event = "email_send.deletion_deferred", message_id = %message.db_id,
            link_id = %link.id, "retained message for accepted delivery");
        return Ok(());
    }
    if deletion == MessageDeletion::AlreadyDeleted {
        tracing::debug!(
            message_id = %message.db_id,
            link_id = %link.id,
            "Message already deleted by a concurrent operation"
        );
        return Ok(());
    }

    publish_email_event(
        &ctx.effects,
        &EmailMacroEvent::message_deleted(MessageDeletedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            message_id: message.db_id,
            provider_message_id: payload.provider_message_id.clone(),
            thread_id: message.thread_db_id,
        }),
    );

    // tell FE to refresh user's inbox
    ctx.effects
        .refresh(
            link.macro_id.as_ref(),
            InboxSyncRefresh::DeleteMessage(link.id),
        )
        .await;

    Ok(())
}
