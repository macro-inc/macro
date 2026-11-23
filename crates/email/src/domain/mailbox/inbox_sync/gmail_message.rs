use super::*;
use crate::domain::backfill_jobs::BackfillJobRepository;
use email_api_client::domain::models::{EmailApiError, SyncCursor};
use models_email::gmail::inbox_sync::{GmailMessagePayload, InboxSyncOperation};
use models_email::service::backfill::{
    BackfillJob, BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use uuid::Uuid;
// handle the initial message received from gmail notifying us of inbox changes.
// ensure the message is valid, then send off pubsub messages for each change.
#[tracing::instrument(skip(ctx))]
pub(super) async fn gmail_message<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &Link,
    payload: &GmailMessagePayload,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let db_history_id = ctx
        .repository
        .history_id(link.email_address.0.as_ref())
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to fetch history id from db"),
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

    // A rate-limited notification is requeued like its child operations rather
    // than dropped: an idle mailbox may get no later notification to cover
    // this cursor range.
    let operation = || InboxSyncOperation::GmailMessage(payload.clone());
    let labels = match ctx.gmail.catalog(link.id).await {
        Ok(labels) => labels,
        Err(error) => {
            return Err(handle_operation_error(
                &ctx.queue,
                ctx.retry_worker,
                link.id,
                operation(),
                error,
            )
            .await);
        }
    };
    super::catalog::sync_labels(&ctx.repository, link.id, &labels)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to reconcile labels"),
            })
        })?;

    let change_batch = match ctx
        .gmail
        .changes(link.id, &SyncCursor::gmail(&db_history_id))
        .await
    {
        Ok(batch) => batch,
        Err(EmailApiError::OutdatedCursor) => {
            schedule_stale_cursor_backfill(ctx, link, payload.history_id).await?;
            let error = EmailApiError::OutdatedCursor;
            return Err(handle_operation_error(
                &ctx.queue,
                ctx.retry_worker,
                link.id,
                operation(),
                error,
            )
            .await);
        }
        Err(error) => {
            return Err(handle_operation_error(
                &ctx.queue,
                ctx.retry_worker,
                link.id,
                operation(),
                error,
            )
            .await);
        }
    };

    ctx.effects
        .accept_history(link.id, &db_history_id, change_batch)
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::Error::new(error)
                    .context("Failed to atomically accept Gmail history and its work"),
            })
        })?;

    Ok(())
}

async fn schedule_stale_cursor_backfill<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &Link,
    notification_history_id: u64,
) -> result::Result<(), ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    let (job, created) = ensure_recovery_backfill_job(
        &ctx.effects.recovery_jobs(),
        link.id,
        link.fusionauth_user_id.as_str(),
    )
    .await?;

    let message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::Init(JobScopedPayload {
            link_id: link.id,
            job_id: job.id,
            payload: InitPayload {},
        }),
    };

    if let Err(enqueue_error) = ctx.queue.enqueue_backfill(message).await {
        if created {
            ctx.effects
                .recovery_jobs()
                .fail_active(job.id)
                .await
                .map_err(|e| recovery_db_error(e.into_original()))?;
        }
        return Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error
                .into_original()
                .context("Failed to enqueue stale-cursor backfill"),
        }));
    }

    repair_stale_cursor(&ctx.repository, link.id, notification_history_id).await;

    Ok(())
}

/// Finds the link's active backfill job, creating one when none exists.
///
/// Returns the job and whether it was created by this call.
pub async fn ensure_recovery_backfill_job<J: BackfillJobRepository>(
    db: &J,
    link_id: Uuid,
    fusionauth_user_id: &str,
) -> result::Result<(BackfillJob, bool), ProcessingError>
where
    J::Err: ConnectionSourceError,
{
    let existing_job = db
        .active_job(link_id)
        .await
        .map_err(|e| recovery_db_error(e.into_original()))?;

    if let Some(job) = existing_job {
        return Ok((job, false));
    }

    match db
        .insert(
            link_id,
            fusionauth_user_id,
            None,
            // Stale-cursor recovery: refresh existing threads so the gap window's
            // replies are recovered (see backfill_thread's refresh path).
            true,
        )
        .await
        .map_err(|e| recovery_db_error(e.into_original()))?
    {
        Some(job) => Ok((job, true)),
        None => {
            let job = db
                .active_job(link_id)
                .await
                .map_err(|e| recovery_db_error(e.into_original()))?
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
pub async fn repair_stale_cursor<R: InboxSyncImportRepository>(
    db: &R,
    link_id: Uuid,
    notification_history_id: u64,
) {
    let _ = db
        .repair_history(link_id, &notification_history_id.to_string())
        .await
        .map_err(ConnectionSourceError::into_original)
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
