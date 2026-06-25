//! The refresh sweep: for a single cadence, decide per `user_ai_projection`
//! instance whether to delete it, refresh it, or leave it untouched.
//!
//! Decision rules (see `ai_projections.md`):
//! - **Delete** when an instance has not been requested within its expiry window
//!   (`now() - last_requested_at > expiry`). A future request recreates it.
//! - **Refresh** when an instance is still active but its cached result is stale
//!   (`now() > stale_at`) and it is not already in flight.
//! - **Leave** everything else ("hot") alone.
//!
//! All queries live here in the lambda crate. The `expiry` window is expressed
//! directly in SQL via a `CASE` over the definition's `expiry` text.

#[cfg(test)]
mod test;

use futures::StreamExt;
use models_ai_projection::AiProjectionQueueMessage;
use sqlx::{Pool, Postgres};

use crate::context::Context;
use crate::event::RefreshCadence;

/// How many refresh messages to enqueue concurrently.
const ENQUEUE_CONCURRENCY: usize = 10;

/// Counts produced by a single sweep, for logging.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RefreshStats {
    /// Inactive instances deleted.
    pub deleted: u64,
    /// Stale instances claimed and queued for refresh.
    pub refreshed: u64,
    /// Refresh messages that failed to enqueue.
    pub enqueue_failures: u64,
}

/// A stale instance that has been claimed (marked `refreshing`) and needs a
/// materialization message enqueued.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RefreshTarget {
    ai_projection_id: String,
    target_id: String,
    prompt_hash: String,
}

/// Runs the refresh sweep for the given cadence: delete inactive instances,
/// claim stale-but-active instances, and enqueue a materialization message for
/// each claimed instance.
#[tracing::instrument(skip(ctx), err)]
pub async fn run(ctx: &Context, cadence: RefreshCadence) -> anyhow::Result<RefreshStats> {
    let deleted = delete_inactive(&ctx.db, cadence).await?;
    tracing::info!(
        cadence = cadence.as_str(),
        deleted,
        "deleted inactive instances"
    );

    let targets = claim_stale(&ctx.db, cadence).await?;
    tracing::info!(
        cadence = cadence.as_str(),
        claimed = targets.len(),
        "claimed stale instances for refresh"
    );

    let enqueue_failures = enqueue_all(ctx, targets.iter()).await;

    let stats = RefreshStats {
        deleted,
        refreshed: targets.len() as u64,
        enqueue_failures,
    };
    Ok(stats)
}

/// Deletes instances of this cadence that have not been requested within their
/// expiry window, regardless of status. Returns the number of rows deleted.
#[tracing::instrument(skip(db), err)]
async fn delete_inactive(db: &Pool<Postgres>, cadence: RefreshCadence) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM user_ai_projection u
        USING ai_projection p
        WHERE u.ai_projection_id = p.id
          AND p.refresh_cadence = $1
          AND u.last_requested_at < NOW() - (
                CASE p.expiry
                    WHEN 'day'   THEN INTERVAL '1 day'
                    WHEN 'week'  THEN INTERVAL '7 days'
                    WHEN 'month' THEN INTERVAL '30 days'
                END)
        "#,
        cadence.as_str(),
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

/// Atomically marks stale-but-active instances of this cadence as `refreshing`
/// and returns them so a materialization message can be enqueued for each.
///
/// Doing the selection and the status flip in one statement prevents two
/// overlapping sweeps from both enqueuing the same instance. Instances stuck in
/// `refreshing` for more than 15 minutes (e.g. a previous sweep that failed to
/// enqueue) are reclaimed, mirroring the `processing_ai_projections` lease
/// reclaim convention used by the worker.
#[tracing::instrument(skip(db), err)]
async fn claim_stale(
    db: &Pool<Postgres>,
    cadence: RefreshCadence,
) -> anyhow::Result<Vec<RefreshTarget>> {
    let rows = sqlx::query!(
        r#"
        UPDATE user_ai_projection u
        SET status = 'refreshing', updated_at = NOW()
        FROM ai_projection p
        WHERE u.ai_projection_id = p.id
          AND p.refresh_cadence = $1
          AND u.stale_at IS NOT NULL
          AND u.stale_at < NOW()
          AND u.last_requested_at >= NOW() - (
                CASE p.expiry
                    WHEN 'day'   THEN INTERVAL '1 day'
                    WHEN 'week'  THEN INTERVAL '7 days'
                    WHEN 'month' THEN INTERVAL '30 days'
                END)
          AND (
                u.status IN ('ready', 'error')
                OR (u.status = 'refreshing' AND u.updated_at < NOW() - INTERVAL '15 minutes')
              )
        RETURNING u.ai_projection_id, u.target_id, p.prompt_hash
        "#,
        cadence.as_str(),
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| RefreshTarget {
            ai_projection_id: row.ai_projection_id,
            target_id: row.target_id,
            prompt_hash: row.prompt_hash,
        })
        .collect())
}

/// Enqueues a materialization message for each claimed target with bounded
/// concurrency. A failed enqueue is logged and counted; the instance stays
/// `refreshing` and is reclaimed by a later sweep after the 15-minute window.
async fn enqueue_all<'a>(ctx: &Context, targets: impl Iterator<Item = &'a RefreshTarget>) -> u64 {
    futures::stream::iter(targets)
        .map(|target| async move {
            ctx.sqs_client
                .enqueue_ai_projection_message(AiProjectionQueueMessage {
                    ai_projection_id: target.ai_projection_id.clone(),
                    target_id: target.target_id.clone(),
                    prompt_hash: target.prompt_hash.clone(),
                })
                .await
                .inspect_err(|e| {
                    tracing::error!(
                        error = ?e,
                        ai_projection_id = %target.ai_projection_id,
                        target_id = %target.target_id,
                        "failed to enqueue ai projection refresh"
                    );
                })
                .is_err()
        })
        .buffer_unordered(ENQUEUE_CONCURRENCY)
        .filter(|failed| futures::future::ready(*failed))
        .count()
        .await as u64
}
