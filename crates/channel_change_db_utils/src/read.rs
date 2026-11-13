//! Counter and bounded log reads for callers that own authorization and policy.

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{Log, LogRow};

/// Read the committed counter, returning zero before a channel's first change.
pub async fn current_seq(pool: &PgPool, channel_id: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(r#"SELECT COALESCE((SELECT seq FROM channel_change_counters WHERE channel_id = $1), 0) AS "seq!""#, channel_id)
        .fetch_one(pool).await
}

/// Read the counter, retained floor and at most `limit` rows in one snapshot.
/// `max_lag` bounds replay work; callers decide when a client must reset.
/// The caller owns the transaction and its statement timeout.
pub async fn read_log(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    after: i64,
    max_lag: i64,
    limit: i64,
) -> Result<Log, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
            WITH position AS MATERIALIZED (
                SELECT COALESCE((
                    SELECT seq FROM channel_change_counters WHERE channel_id = $1
                ), 0) AS seq
            )
            SELECT position.seq AS "counter!",
                COALESCE((
                    SELECT min(retained.seq) - 1
                    FROM channel_change_log retained WHERE retained.channel_id = $1
                ), position.seq) AS "floor!",
                change.seq AS "log_seq?", change.kind AS "kind?",
                change.message_id AS "message_id?", change.activity_id AS "activity_id?"
            FROM position
            LEFT JOIN LATERAL (
                SELECT log.seq, log.kind, log.message_id, log.activity_id
                FROM channel_change_log log
                WHERE log.channel_id = $1 AND log.seq > $2
                    AND position.seq - $2 <= $3
                ORDER BY log.seq
                LIMIT $4
            ) change ON true
            ORDER BY change.seq
            "#,
        channel_id,
        after,
        max_lag,
        limit,
    )
    .fetch_all(&mut **tx)
    .await?;
    let mut log = Log::default();
    for row in rows {
        log.counter = row.counter;
        log.floor = row.floor;
        if let (Some(seq), Some(kind)) = (row.log_seq, row.kind) {
            log.rows.push(LogRow {
                seq,
                kind,
                message_id: row.message_id,
                activity_id: row.activity_id,
            });
        }
    }
    Ok(log)
}
