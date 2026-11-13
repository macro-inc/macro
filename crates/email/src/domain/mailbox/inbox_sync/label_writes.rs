use super::{InboxSyncLabelTransaction, InboxSyncRepository, InboxSyncTransaction};
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::service::{self, link};
use std::result;
use uuid::Uuid;

#[tracing::instrument(skip(db, link))]
pub(super) async fn add_message_labels<R: InboxSyncRepository>(
    db: &R,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple changes
    let mut tx = db.begin_labels().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.into_original().context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        // `label_diff` already left pending labels out of `provider_label_ids`.
        tx.add_labels(link.id, message_db_id, provider_label_ids)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e
                        .into_original()
                        .context("Failed to insert message labels".to_string()),
                })
            })?;

        // if we are adding unread label, mark message as not read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            tx.set_read(link.id, message_db_id, false)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e
                            .into_original()
                            .context("Failed to update message read status".to_string()),
                    })
                })?;
        }

        // Gmail's STARRED label is the starred flag the inbox shows.
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::STARRED)
        {
            tx.set_starred(link.id, message_db_id, true)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e
                            .into_original()
                            .context("Failed to update message starred status"),
                    })
                })?;
        }

        tx.update_thread(link.id, thread_db_id).await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to update thread metadata".to_string()),
            })
        })?;

        Ok::<(), ProcessingError>(())
    }
    .await;

    tx.complete(result).await
}

#[tracing::instrument(skip(db, link))]
pub(super) async fn remove_message_labels<R: InboxSyncRepository>(
    db: &R,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple db changes
    let mut tx = db.begin_labels().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.into_original().context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        tx.remove_labels(link.id, message_db_id, provider_label_ids)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.into_original().context("Failed to delete message labels"),
                })
            })?;

        // if we are removing unread label, mark message as read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            tx.set_read(link.id, message_db_id, true)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e
                            .into_original()
                            .context("Failed to update message read status"),
                    })
                })?;
        }

        // Gmail's STARRED label is the starred flag the inbox shows.
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::STARRED)
        {
            tx.set_starred(link.id, message_db_id, false)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e
                            .into_original()
                            .context("Failed to update message starred status"),
                    })
                })?;
        }

        tx.update_thread(link.id, thread_db_id).await.map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to update thread metadata"),
            })
        })?;

        Ok::<(), ProcessingError>(())
    }
    .await;

    tx.complete(result).await
}
