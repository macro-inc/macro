use crate::pubsub::inbox_sync::operations::gmail_message::schedule_recovery_backfill;
use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::link_manager::process::{retry_teardown, settle_reauth_fetch};
use crate::util::redis::lock::RedisLock;
use anyhow::Context;
use chrono::{DateTime, Utc};
use email_api_client::domain::models::{EmailApiError, SyncCursor};
use models_email::email::service::pubsub::DeletionReason;
use models_email::gmail::inbox_sync::{
    GmailMessagePayload, InboxSyncOperation, InboxSyncPubsubMessage,
};
use models_email::service::link::{Link, UserProvider};
use std::time::Duration;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// How many of the most recent threads a resumed link re-syncs when its Gmail history
/// no longer reaches back to when it was paused.
const RESUME_RESYNC_THREAD_LIMIT: i32 = 500;

/// Outlives a transition's provider calls, including teardown retries, so the lock
/// only lapses if a worker dies mid-transition.
const RETENTION_LOCK_TTL: Duration = Duration::from_secs(120);

/// How long a transition waits for the other one to finish before the message is
/// left for redelivery.
const RETENTION_LOCK_WAIT: Duration = Duration::from_secs(15);

/// How a resumed link catches up on the mail it missed while paused.
#[derive(Debug, PartialEq, Eq)]
enum CatchUp {
    /// The stored Gmail history cursor is still valid: replay changes since it.
    Incremental,
    /// The cursor is missing or Gmail has expired it: re-sync recent threads instead.
    PartialResync,
}

/// Chooses the catch-up from probing the stored cursor (`None` when there is no
/// usable cursor). Errors that a retry or reauth can fix are returned; any other
/// provider rejection of the cursor falls back to a partial resync.
fn choose_catch_up<T>(probe: Option<Result<T, EmailApiError>>) -> Result<CatchUp, EmailApiError> {
    match probe {
        Some(Ok(_)) => Ok(CatchUp::Incremental),
        Some(Err(error))
            if error.is_transient() || matches!(error, EmailApiError::AuthRequired) =>
        {
            Err(error)
        }
        Some(Err(_)) | None => Ok(CatchUp::PartialResync),
    }
}

/// Pauses sync for a link the retention sweep found idle: no backfill, push
/// processing, refresh or health polling until someone opens the app again. The
/// mailbox data and the Google grant are kept so sync can resume.
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
pub(super) async fn handle_pause(
    ctx: &LinkManagerContext,
    link: &Link,
    idle_before: DateTime<Utc>,
) -> anyhow::Result<()> {
    let paused = email_db_client::links::retention::pause_link_sync(&ctx.db, link.id, idle_before)
        .await
        .context("Failed to pause link sync")?;
    if !paused {
        tracing::info!("Link was used after the retention sweep or is being removed; not pausing");
        return Ok(());
    }

    email_db_client::backfill::job::update::cancel_active_jobs_by_link_id(&ctx.db, link.id)
        .await
        .inspect_err(|error| tracing::error!(error=?error, "Failed to cancel backfill jobs"))
        .ok();

    // Health-neutral like deletion: a dead grant on an idle mailbox must not mark it for
    // reauth or notify anyone. Pushes that still arrive are dropped because the link is
    // no longer sync-active, so a failed stop only costs ignored notifications until the
    // watch expires.
    retry_teardown(|| ctx.email_api.stop_subscription_for_link(link))
        .await
        .inspect_err(|error| tracing::warn!(error=?error, "Gmail call to stop watch failed"))
        .ok();

    tracing::info!("Paused sync for idle link");
    Ok(())
}

/// Serializes pause and resume for one link, so a pause's job cancellation and
/// watch teardown can never interleave with a resume's recovery job, watch
/// registration and cursor write. Hold it across reading the link and the whole
/// transition. Failing to acquire it errors so the message is redelivered.
pub(super) async fn lock_link(
    ctx: &LinkManagerContext,
    link_id: Uuid,
) -> anyhow::Result<RedisLock> {
    ctx.redis_client
        .acquire_lock(
            &format!("email_link_retention:{link_id}"),
            RETENTION_LOCK_TTL,
            RETENTION_LOCK_WAIT,
        )
        .await
        .context("Failed to acquire link retention lock")
}

/// Whether a delete should go ahead. Retention deletes (unused or inactive) are
/// skipped when activity resumed the link after the sweep selected it; every other
/// deletion is unconditional.
pub(super) async fn claim_for_delete(
    ctx: &LinkManagerContext,
    link: &Link,
    deletion_reason: &DeletionReason,
) -> anyhow::Result<bool> {
    if !matches!(
        deletion_reason,
        DeletionReason::Unused | DeletionReason::Inactive
    ) {
        return Ok(true);
    }

    let claimed = email_db_client::links::retention::claim_idle_link_for_deletion(&ctx.db, link.id)
        .await
        .context("Failed to claim idle link for deletion")?;
    if !claimed {
        tracing::info!(link_id=%link.id, deletion_reason=deletion_reason.as_str(), "Link was resumed after the retention sweep; not deleting");
    }
    Ok(claimed)
}

/// Restarts sync for a link that user activity resumed: renews the Gmail watch and
/// catches up incrementally from the stored history cursor, or re-syncs recent
/// threads when Gmail has expired that history.
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
pub(super) async fn handle_resume(ctx: &LinkManagerContext, link: &Link) -> anyhow::Result<()> {
    let probe = probe_sync_cursor(ctx, link).await?;
    let catch_up = match choose_catch_up(probe) {
        Ok(catch_up) => catch_up,
        Err(EmailApiError::AuthRequired) => {
            settle_reauth_fetch(ctx, link, Err(EmailApiError::AuthRequired)).await?;
            return Ok(());
        }
        Err(error) => {
            return Err(anyhow::Error::new(error).context("Failed to check Gmail sync cursor"));
        }
    };

    // Start the resync before the watch exists, so a push that races the watch
    // registration below reuses this capped job instead of recovering the whole mailbox.
    if catch_up == CatchUp::PartialResync {
        tracing::info!("Gmail history expired while paused; re-syncing recent threads");
        schedule_recovery_backfill(
            &ctx.db,
            &ctx.sqs_client,
            link,
            Some(RESUME_RESYNC_THREAD_LIMIT),
        )
        .await
        .map_err(anyhow::Error::new)?;
    }

    let subscription = match ctx.email_api.register_subscription(link.id).await {
        Ok(subscription) => subscription,
        Err(EmailApiError::AuthRequired) => {
            settle_reauth_fetch(ctx, link, Err(EmailApiError::AuthRequired)).await?;
            return Ok(());
        }
        Err(error) if error.is_transient() => {
            return Err(anyhow::Error::new(error).context("Failed to renew Gmail watch"));
        }
        Err(error) => {
            // The daily refresh renews the watch, and the next push catches up from
            // the stored cursor.
            tracing::error!(error=?error, "Failed to renew Gmail watch on resume");
            return Ok(());
        }
    };
    let current_cursor = subscription.cursor.as_str();

    match catch_up {
        CatchUp::Incremental => {
            let history_id = current_cursor
                .parse::<u64>()
                .context("Gmail watch returned a non-numeric history id")?;
            ctx.sqs_client
                .enqueue_gmail_inbox_sync_notification(InboxSyncPubsubMessage {
                    link_id: link.id,
                    operation: InboxSyncOperation::GmailMessage(GmailMessagePayload { history_id }),
                })
                .await
                .context("Failed to enqueue resume catch-up")?;
        }
        CatchUp::PartialResync => {
            email_db_client::histories::upsert_gmail_history(&ctx.db, link.id, current_cursor)
                .await
                .context("Failed to store resumed Gmail history cursor")?;
        }
    }

    tracing::info!(?catch_up, "Resumed sync for link");
    Ok(())
}

/// Lists changes since the stored cursor to learn whether Gmail still has that
/// history. Returns `None` when there is no parseable cursor to probe.
async fn probe_sync_cursor(
    ctx: &LinkManagerContext,
    link: &Link,
) -> anyhow::Result<Option<Result<(), EmailApiError>>> {
    let stored = email_db_client::histories::fetch_history_id_for_link(
        &ctx.db,
        link.email_address.0.as_ref(),
        UserProvider::Gmail,
    )
    .await
    .context("Failed to fetch stored Gmail history id")?;

    let Some(cursor) = stored.filter(|cursor| cursor.parse::<u64>().is_ok()) else {
        return Ok(None);
    };

    Ok(Some(
        ctx.email_api
            .list_changes(link.id, &SyncCursor::gmail(cursor))
            .await
            .map(|_| ()),
    ))
}
