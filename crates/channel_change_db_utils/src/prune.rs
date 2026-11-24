//! Bounded deletion that keeps counters monotonic after retention.

use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

/// Take the transaction-scoped lock that admits one pruner at a time.
/// Returns false, without waiting, while another transaction holds it.
pub async fn try_lock_prune_in(tx: &mut Transaction<'_, Postgres>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(
            hashtextextended('channel_change_log.prune', 0)
        ) AS "locked!""#
    )
    .fetch_one(&mut **tx)
    .await
}

/// Remove at most `batch` counters of channels that no longer exist.
///
/// A removed channel's log goes with it, but its counter is left for this
/// sweep, as is one an activity recreated after the channel was gone. Only
/// counters idle since before `cutoff` are looked at, so none is taken from
/// under a write in flight. The caller owns the transaction and its timeout.
pub async fn prune_orphaned_counters_in(
    tx: &mut Transaction<'_, Postgres>,
    cutoff: DateTime<Utc>,
    batch: i64,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query!(
        r#"
            DELETE FROM channel_change_counters
            WHERE channel_id = ANY(ARRAY(
                SELECT counter.channel_id FROM channel_change_counters counter
                WHERE counter.updated_at < $1
                    AND NOT EXISTS (
                        SELECT 1 FROM comms_channels WHERE id = counter.channel_id
                    )
                LIMIT $2
            )) AND updated_at < $1
            "#,
        cutoff,
        batch,
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Remove at most `batch` oldest rows before `cutoff`, preserving counters.
/// The caller owns retention policy, transaction, and statement timeout.
pub async fn prune_in(
    tx: &mut Transaction<'_, Postgres>,
    cutoff: DateTime<Utc>,
    batch: i64,
) -> Result<u64, sqlx::Error> {
    // A TID array prevents a generic plan from scanning the complete log.
    // Rows are immutable and selection/deletion share the same statement.
    // channel_change_log_created_idx gives the rows in created_at order; the
    // tie-break is an incremental sort within one timestamp, measured at
    // 14 ms for 10,000 of 2,000,000 rows. A wider index was no faster.
    Ok(sqlx::query!(
        r#"
            DELETE FROM channel_change_log
            WHERE ctid = ANY(ARRAY(
                SELECT ctid FROM channel_change_log
                WHERE created_at < $1
                ORDER BY created_at, channel_id, seq
                LIMIT $2
            ))
            "#,
        cutoff,
        batch,
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}
