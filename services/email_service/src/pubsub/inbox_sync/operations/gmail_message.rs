use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::email_api_error::handle_gmail_message_error;
use crate::util::process_pre_insert::sync_labels::sync_labels;
use email_api_client::domain::models::{EmailApiError, InboxChanges, SyncCursor};
use models_email::email::service::backfill::BackfillJob;
use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use models_email::gmail::inbox_sync::{
    DeleteMessagePayload, GmailMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
    UpdateLabelsPayload, UpsertMessagePayload,
};
use models_email::service::link::{Link, UserProvider};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqlx::PgPool;
use std::result;
use uuid::Uuid;

#[cfg(test)]
mod test;

// handle the initial message received from gmail notifying us of inbox changes.
// ensure the message is valid, then send off pubsub messages for each change.
#[tracing::instrument(skip(ctx))]
pub async fn gmail_message(
    ctx: &PubSubContext,
    link: &Link,
    payload: &GmailMessagePayload,
) -> result::Result<(), ProcessingError> {
    let db_history_id = email_db_client::histories::fetch_history_id_for_link(
        &ctx.db,
        link.email_address.0.as_ref(),
        UserProvider::Gmail,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch history id from db"),
        })
    })?
    .ok_or_else(|| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::anyhow!("History id not found for user"),
        })
    })?;

    let db_history_u64 = match db_history_id.parse::<u64>() {
        Ok(history_id) => history_id,
        Err(error) => {
            schedule_stale_cursor_backfill(ctx, link, payload.history_id).await?;
            return Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::OutdatedHistoryId,
                source: anyhow::Error::from(error)
                    .context("Failed to parse current history_id as u64"),
            }));
        }
    };

    if db_history_u64 >= payload.history_id {
        return Ok(());
    }

    // Gmail message notifications intentionally refuse labels/history work when quota is
    // exhausted. A later notification will cover the same cursor range, avoiding fan-out
    // backpressure while preserving the separate retry queue for child operations.
    let labels = ctx
        .email_api
        .list_labels(link.id)
        .await
        .map_err(handle_gmail_message_error)?;
    sync_labels(&ctx.db, link.id, &labels).await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to reconcile labels"),
        })
    })?;

    let change_batch = match ctx
        .email_api
        .list_changes(link.id, &SyncCursor::gmail(&db_history_id))
        .await
    {
        Ok(batch) => batch,
        Err(EmailApiError::OutdatedCursor) => {
            schedule_stale_cursor_backfill(ctx, link, payload.history_id).await?;
            return Err(handle_gmail_message_error(EmailApiError::OutdatedCursor));
        }
        Err(error) => return Err(handle_gmail_message_error(error)),
    };

    email_db_client::histories::upsert_gmail_history(
        &ctx.db,
        link.id,
        change_batch.next_cursor.as_str(),
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to upsert gmail history"),
        })
    })?;

    for ps_message in build_pubsub_messages(link.id, change_batch.changes) {
        let message_for_error = ps_message.clone();
        ctx.sqs_client
            .enqueue_gmail_inbox_sync_notification(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context(format!("Failed to enqueue message {message_for_error:?}")),
                })
            })?;
    }

    Ok(())
}

async fn schedule_stale_cursor_backfill(
    ctx: &PubSubContext,
    link: &Link,
    notification_history_id: u64,
) -> result::Result<(), ProcessingError> {
    let (job, created) =
        ensure_recovery_backfill_job(&ctx.db, link.id, link.fusionauth_user_id.as_str()).await?;

    let message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::Init(JobScopedPayload {
            link_id: link.id,
            job_id: job.id,
            payload: InitPayload {},
        }),
    };

    if let Err(enqueue_error) = ctx.sqs_client.enqueue_email_backfill_message(message).await {
        if created {
            email_db_client::backfill::job::update::fail_backfill_job(&ctx.db, job.id)
                .await
                .map_err(recovery_db_error)?;
        }
        return Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error.context("Failed to enqueue stale-cursor backfill"),
        }));
    }

    repair_stale_cursor(&ctx.db, link.id, notification_history_id).await;

    Ok(())
}

/// Finds the link's active backfill job, creating one when none exists.
///
/// Returns the job and whether it was created by this call.
async fn ensure_recovery_backfill_job(
    db: &PgPool,
    link_id: Uuid,
    fusionauth_user_id: &str,
) -> result::Result<(BackfillJob, bool), ProcessingError> {
    let existing_job = email_db_client::backfill::job::get::get_active_backfill_job(db, link_id)
        .await
        .map_err(recovery_db_error)?;

    if let Some(job) = existing_job {
        return Ok((job, false));
    }

    match email_db_client::backfill::job::insert::create_backfill_job(
        db,
        link_id,
        fusionauth_user_id,
        None,
        // Stale-cursor recovery: refresh existing threads so the gap window's
        // replies are recovered (see backfill_thread's refresh path).
        true,
    )
    .await
    .map_err(recovery_db_error)?
    {
        Some(job) => Ok((job, true)),
        None => {
            let job = email_db_client::backfill::job::get::get_active_backfill_job(db, link_id)
                .await
                .map_err(recovery_db_error)?
                .ok_or_else(|| {
                    recovery_db_error(anyhow::anyhow!(
                        "backfill insert conflicted but no active job was found"
                    ))
                })?;
            Ok((job, false))
        }
    }
}

/// Persists the notification's history id as the link's sync cursor once a
/// recovery backfill covers the gap.
///
/// Without this write the expired cursor stays in place, so every subsequent
/// notification re-enters the `OutdatedCursor` arm and schedules another
/// full-mailbox backfill forever. A write failure is deliberately swallowed:
/// the notification is dropped either way, and the next notification re-enters
/// this path (reusing the active job) and retries the repair.
async fn repair_stale_cursor(db: &PgPool, link_id: Uuid, notification_history_id: u64) {
    let _ = email_db_client::histories::upsert_gmail_history(
        db,
        link_id,
        &notification_history_id.to_string(),
    )
    .await
    .inspect_err(|error| {
        tracing::warn!(error = ?error, %link_id, "failed to repair stale gmail sync cursor");
    });
}

fn recovery_db_error(error: impl Into<anyhow::Error>) -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::DatabaseQueryFailed,
        source: error
            .into()
            .context("Failed to schedule stale-cursor backfill"),
    })
}

/// Builds pubsub messages from history data.
fn build_pubsub_messages(
    link_id: Uuid,
    inbox_changes: InboxChanges,
) -> Vec<InboxSyncPubsubMessage> {
    let mut pubsub_messages = Vec::new();

    for message_id in inbox_changes.message_ids_to_upsert {
        pubsub_messages.push(InboxSyncPubsubMessage {
            link_id,
            operation: InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
                provider_message_id: message_id,
            }),
        });
    }
    for message_id in inbox_changes.message_ids_to_delete {
        pubsub_messages.push(InboxSyncPubsubMessage {
            link_id,
            operation: InboxSyncOperation::DeleteMessage(DeleteMessagePayload {
                provider_message_id: message_id,
            }),
        });
    }
    for message_id in inbox_changes.labels_to_update {
        pubsub_messages.push(InboxSyncPubsubMessage {
            link_id,
            operation: InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                provider_message_id: message_id,
            }),
        });
    }

    pubsub_messages
}
