use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::operations::shared::notify_search;
use crate::pubsub::inbox_sync::process;
use crate::pubsub::inbox_sync::process::check_gmail_rate_limit_inbox_sync;
use crate::pubsub::util::{
    cg_refresh_email, complete_transaction_with_processing_error, publish_email_event,
};
use email::domain::events::{
    EmailEventOrigin, EmailMacroEvent, LabelRef, ThreadArchivedMetadata,
    ThreadLabelsUpdatedMetadata, ThreadReadMetadata, ThreadStarredMetadata, ThreadTrashedMetadata,
};
use email_db_client::labels::delete::delete_db_message_labels;
use email_db_client::labels::insert;
use email_db_client::threads::update::update_thread_metadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::email::service::link;
use models_email::gmail::inbox_sync::{
    InboxSyncOperation, InboxSyncPubsubMessage, UpdateLabelsPayload, UpsertMessagePayload,
};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqlx::PgPool;
use std::result;
use uuid::Uuid;

/// Compares a db message's labels to the gmail message's labels, adding/removing as necessary
#[tracing::instrument(skip(ctx))]
pub async fn update_labels(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpdateLabelsPayload,
) -> result::Result<(), ProcessingError> {
    let gmail_access_token = process::fetch_pubsub_gmail_token(ctx, link).await?;
    let provider_message_id = &payload.provider_message_id;

    // fetch simple message to get db_id from provider_id
    let db_message_opt =
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &ctx.db,
            provider_message_id,
            &link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to get simple message from db".to_string()),
            })
        })?;

    let db_message = match db_message_opt {
        Some(m) => m,
        None => {
            // if message exists in gmail but not in db, we should try to upsert it
            ctx.sqs_client
                .enqueue_gmail_inbox_sync_notification(InboxSyncPubsubMessage {
                    link_id: link.id,
                    operation: InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
                        provider_message_id: provider_message_id.clone(),
                    }),
                })
                .await
                .map_err(|e| {
                    ProcessingError::NonRetryable(DetailedError {
                        reason: FailureReason::SqsEnqueueFailed,
                        source: e.context(format!(
                            "Failed to enqueue upsert message {:?} for missing message on label update",
                            provider_message_id
                        )),
                    })
                })?;

            return Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::MessageNotFoundInDatabase,
                source: anyhow::anyhow!(
                    "Message {} not found in database. Upsert message queued.",
                    provider_message_id
                ),
            }));
        }
    };

    let db_message_labels =
        email_db_client::labels::get::fetch_message_labels(&ctx.db, db_message.db_id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to get message labels from db".to_string()),
                })
            })?;

    // get the message labels from gmail
    check_gmail_rate_limit_inbox_sync(
        ctx,
        link.id,
        GmailApiOperation::MessagesGet,
        InboxSyncOperation::UpdateLabels(payload.clone()),
    )
    .await?;

    let gmail_message_labels = match ctx
        .gmail_client
        .get_message_label_ids(&gmail_access_token, &payload.provider_message_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get message from gmail api".to_string()),
            })
        })? {
        Some(labels) => labels,
        None => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in gmail when attempting to update labels");
            return Ok(());
        }
    };

    let labels_to_add: Vec<String> = gmail_message_labels
        .iter()
        .filter(|gmail_label| {
            !db_message_labels
                .iter()
                .any(|db_label| &db_label.provider_label_id == *gmail_label)
        })
        .cloned()
        .collect();

    let labels_to_delete: Vec<String> = db_message_labels
        .iter()
        .filter(|db_label| !gmail_message_labels.contains(&db_label.provider_label_id))
        .map(|label| label.provider_label_id.clone())
        .collect();

    let has_label_changes = !labels_to_add.is_empty() || !labels_to_delete.is_empty();

    if !labels_to_add.is_empty() {
        add_message_labels(
            &ctx.db,
            link,
            db_message.db_id,
            db_message.thread_db_id,
            &labels_to_add,
        )
        .await?
    }

    if !labels_to_delete.is_empty() {
        remove_message_labels(
            &ctx.db,
            link,
            db_message.db_id,
            db_message.thread_db_id,
            &labels_to_delete,
        )
        .await?
    }

    if has_label_changes {
        // Publish semantic macro.email events before the fallible search
        // notify: a notify failure retries the whole op, and on retry the
        // label diff is empty so the events would be lost.
        publish_label_diff_events(
            ctx,
            link,
            db_message.thread_db_id,
            &labels_to_add,
            &labels_to_delete,
            &db_message_labels,
        )
        .await;

        let is_spam_or_trash = gmail_message_labels.iter().any(|label| {
            label == service::label::system_labels::SPAM
                || label == service::label::system_labels::TRASH
        });

        notify_search(ctx, link, db_message.db_id, is_spam_or_trash).await?;

        // tell FE to refresh user's inbox
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::UpdateLabels { link_id: link.id },
        )
        .await;
    }

    Ok(())
}

/// System labels that never appear in a `thread_labels_updated` event:
/// INBOX/TRASH/UNREAD/STARRED map to dedicated thread-state events, and
/// SPAM/IMPORTANT/SENT/DRAFT changes are not published at all.
const NON_USER_LABELS: [&str; 8] = [
    service::label::system_labels::INBOX,
    service::label::system_labels::SPAM,
    service::label::system_labels::TRASH,
    service::label::system_labels::UNREAD,
    service::label::system_labels::STARRED,
    service::label::system_labels::IMPORTANT,
    service::label::system_labels::SENT,
    service::label::system_labels::DRAFT,
];

/// Publish semantic macro.email events for a provider-side label diff, all
/// with `origin = provider_sync`. Changes made through Macro update the DB
/// optimistically, so by the time they echo back through Gmail history sync
/// there is no diff and nothing is published here — user-initiated changes
/// are published from their handlers, with `origin = user_action`.
///
/// The diff is per message, so a thread-wide provider change (e.g. Gmail
/// marking a whole thread read) produces one event per affected message.
/// For the read/archived states the payload carries the *thread row* state
/// (recomputed by `update_thread_metadata` inside the label ops), so the
/// repeated events are accurate and idempotent rather than message-inferred.
async fn publish_label_diff_events(
    ctx: &PubSubContext,
    link: &link::Link,
    thread_db_id: Uuid,
    labels_to_add: &[String],
    labels_to_delete: &[String],
    db_message_labels: &[models_email::db::label::Label],
) {
    let added = |label: &str| labels_to_add.iter().any(|l| l == label);
    let removed = |label: &str| labels_to_delete.iter().any(|l| l == label);

    let needs_thread_state = added(service::label::system_labels::INBOX)
        || removed(service::label::system_labels::INBOX)
        || added(service::label::system_labels::UNREAD)
        || removed(service::label::system_labels::UNREAD);
    let thread_row = if needs_thread_state {
        email_db_client::threads::get::get_thread_by_id_and_link_id(&ctx.db, thread_db_id, link.id)
            .await
            .inspect_err(
                |e| tracing::warn!(error=?e, thread_id=%thread_db_id, "failed to fetch thread row for macro.email event state"),
            )
            .ok()
            .flatten()
    } else {
        None
    };

    let mut events: Vec<EmailMacroEvent> = Vec::new();

    if added(service::label::system_labels::INBOX) || removed(service::label::system_labels::INBOX)
    {
        events.push(EmailMacroEvent::thread_archived(ThreadArchivedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            actor: None,
            thread_id: thread_db_id,
            archived: thread_row
                .as_ref()
                .map(|t| !t.inbox_visible)
                .unwrap_or_else(|| removed(service::label::system_labels::INBOX)),
            origin: EmailEventOrigin::ProviderSync,
        }));
    }

    if added(service::label::system_labels::TRASH) || removed(service::label::system_labels::TRASH)
    {
        events.push(EmailMacroEvent::thread_trashed(ThreadTrashedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            actor: None,
            thread_id: thread_db_id,
            trashed: added(service::label::system_labels::TRASH),
            origin: EmailEventOrigin::ProviderSync,
        }));
    }

    if added(service::label::system_labels::UNREAD)
        || removed(service::label::system_labels::UNREAD)
    {
        events.push(EmailMacroEvent::thread_read(ThreadReadMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            actor: None,
            thread_id: thread_db_id,
            is_read: thread_row
                .as_ref()
                .map(|t| t.is_read)
                .unwrap_or_else(|| removed(service::label::system_labels::UNREAD)),
            origin: EmailEventOrigin::ProviderSync,
        }));
    }

    if added(service::label::system_labels::STARRED)
        || removed(service::label::system_labels::STARRED)
    {
        events.push(EmailMacroEvent::thread_starred(ThreadStarredMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            actor: None,
            thread_id: thread_db_id,
            starred: added(service::label::system_labels::STARRED),
            origin: EmailEventOrigin::ProviderSync,
        }));
    }

    // Gmail category tabs (CATEGORY_PERSONAL/SOCIAL/...) are provider system
    // labels, not user labels.
    let is_user_label = |l: &str| !NON_USER_LABELS.contains(&l) && !l.starts_with("CATEGORY_");

    let added_user: Vec<LabelRef> = labels_to_add
        .iter()
        .filter(|l| is_user_label(l.as_str()))
        .map(|l| LabelRef {
            label_id: None,
            provider_label_id: l.clone(),
            name: None,
        })
        .collect();
    let removed_user: Vec<LabelRef> = db_message_labels
        .iter()
        .filter(|l| {
            labels_to_delete.contains(&l.provider_label_id)
                && is_user_label(l.provider_label_id.as_str())
        })
        .map(|l| LabelRef {
            label_id: Some(l.id),
            provider_label_id: l.provider_label_id.clone(),
            name: Some(l.name.clone()),
        })
        .collect();

    if !added_user.is_empty() || !removed_user.is_empty() {
        events.push(EmailMacroEvent::thread_labels_updated(
            ThreadLabelsUpdatedMetadata {
                link_id: link.id,
                owner: link.macro_id.clone(),
                actor: None,
                thread_id: thread_db_id,
                added: added_user,
                removed: removed_user,
                origin: EmailEventOrigin::ProviderSync,
            },
        ));
    }

    for event in &events {
        publish_email_event(&ctx.macro_event_broker, event);
    }
}

#[tracing::instrument(skip(db, link))]
pub async fn add_message_labels(
    db: &PgPool,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple changes
    let mut tx = db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e).context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        insert::insert_message_labels(&mut tx, link.id, message_db_id, provider_label_ids, false)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to insert message labels".to_string()),
                })
            })?;

        // if we are adding unread label, mark message as not read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            email_db_client::messages::update::update_message_read_status(
                &mut tx,
                message_db_id,
                &link.fusionauth_user_id,
                false,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update message read status".to_string()),
                })
            })?;
        }

        update_thread_metadata(&mut tx, thread_db_id, link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update thread metadata".to_string()),
                })
            })?;

        Ok::<(), ProcessingError>(())
    }
    .await;

    complete_transaction_with_processing_error(tx, result).await
}

#[tracing::instrument(skip(db, link))]
pub async fn remove_message_labels(
    db: &PgPool,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple db changes
    let mut tx = db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e).context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        delete_db_message_labels(&mut tx, message_db_id, provider_label_ids, link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to delete message labels"),
                })
            })?;

        // if we are removing unread label, mark message as read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            email_db_client::messages::update::update_message_read_status(
                &mut tx,
                message_db_id,
                &link.fusionauth_user_id,
                true,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update message read status"),
                })
            })?;
        }

        update_thread_metadata(&mut tx, thread_db_id, link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update thread metadata"),
                })
            })?;

        Ok::<(), ProcessingError>(())
    }
    .await;

    complete_transaction_with_processing_error(tx, result).await
}
