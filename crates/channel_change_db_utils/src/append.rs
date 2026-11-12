//! Final-statement sequence allocation inside the caller's transaction.

use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{ActivitySequence, Change};

/// Allocate the next channel sequence and append its change in one statement.
/// Call only after all other writes and locks, immediately before commit.
pub async fn append_in(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    change: Change,
) -> Result<i64, sqlx::Error> {
    let (kind, message_id, activity_id): (i16, _, _) = match change {
        Change::Message(id) => (1, Some(id), None),
        Change::Activity(id) => (2, None, Some(id)),
        Change::Reset => (3, None, None),
    };
    sqlx::query_scalar!(
        r#"WITH next AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                VALUES ($1, 1)
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + 1, updated_at = now()
                RETURNING seq
            )
            INSERT INTO channel_change_log (channel_id, seq, kind, message_id, activity_id)
            SELECT $1, next.seq, $2, $3, $4 FROM next
            RETURNING seq AS "seq!""#,
        channel_id,
        kind,
        message_id,
        activity_id,
    )
    .fetch_one(&mut **tx)
    .await
}

/// Append a batch of activity identities as the caller's final statement.
/// Counters lock in channel order; sequence allocation preserves each channel's
/// input order. Match receipts by activity identity; result order is unspecified.
/// Duplicate activity identities deliberately receive another sequence.
pub async fn append_activities_in(
    tx: &mut Transaction<'_, Postgres>,
    channel_ids: &[Uuid],
    activity_ids: &[Uuid],
) -> Result<Vec<ActivitySequence>, sqlx::Error> {
    if channel_ids.len() != activity_ids.len() {
        return Err(sqlx::Error::Protocol(
            "channel and activity counts differ".to_owned(),
        ));
    }
    if channel_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query!(
        r#"
            WITH pending AS MATERIALIZED (
                SELECT channel_id, activity_id,
                       row_number() OVER (PARTITION BY channel_id ORDER BY ordinal) AS position,
                       count(*) OVER (PARTITION BY channel_id) AS total
                FROM UNNEST($1::uuid[], $2::uuid[]) WITH ORDINALITY
                    AS input(channel_id, activity_id, ordinal)
            ), advanced AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                SELECT channel_id, total FROM pending GROUP BY channel_id, total ORDER BY channel_id
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + EXCLUDED.seq,
                    updated_at = clock_timestamp()
                RETURNING channel_id, seq
            )
            INSERT INTO channel_change_log (channel_id, seq, kind, activity_id)
            SELECT pending.channel_id, advanced.seq - pending.total + pending.position,
                   2, pending.activity_id
            FROM pending JOIN advanced USING (channel_id)
            ORDER BY pending.channel_id, pending.position
            RETURNING activity_id AS "activity_id!", seq
            "#,
        channel_ids,
        activity_ids,
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| ActivitySequence {
            activity_id: row.activity_id,
            seq: row.seq,
        })
        .collect())
}
