//! Bounded deletion that keeps counters monotonic after retention.

use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

/// Remove at most `batch` oldest rows before `cutoff`, preserving counters.
/// The caller owns retention policy, transaction, and statement timeout.
pub async fn prune_in(
    tx: &mut Transaction<'_, Postgres>,
    cutoff: DateTime<Utc>,
    batch: i64,
) -> Result<u64, sqlx::Error> {
    // A TID array prevents a generic plan from scanning the complete log.
    // Rows are immutable and selection/deletion share the same statement.
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
