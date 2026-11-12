//! Final-statement sequence allocation inside the caller's transaction.

use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{ActivitySequence, Change};

/// Allocate the next channel sequence and append its change in one statement.
/// Call only after all other writes and locks, immediately before commit.
/// Counter row waits are capped at 50 ms, preserving stricter settings;
/// the previous setting is restored before the statement returns.
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
    // The dependency chain sets the timeout before counter allocation, then
    // consumes every logged row before restoring it. Keep this in one statement
    // so restoration adds no round trip while the counter lock is held.
    sqlx::query_scalar!(
        r#"WITH saved AS MATERIALIZED (
                SELECT current_setting('lock_timeout') AS value
            ), configured AS MATERIALIZED (
                SELECT set_config('lock_timeout', CASE
                    WHEN value::interval > interval '0'
                        AND value::interval < interval '50 milliseconds' THEN value
                    ELSE '50ms' END, true) AS value
                FROM saved
            ), next AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                SELECT $1, 1 FROM configured WHERE configured.value IS NOT NULL
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + 1, updated_at = now()
                RETURNING seq
            ), logged AS (
                INSERT INTO channel_change_log (channel_id, seq, kind, message_id, activity_id)
                SELECT $1, next.seq, $2, $3, $4 FROM next
                RETURNING seq
            ), restored AS MATERIALIZED (
                SELECT set_config('lock_timeout', saved.value, true) AS value
                FROM saved CROSS JOIN (SELECT count(*) AS completed FROM logged) done
                WHERE done.completed > 0
            )
            SELECT logged.seq AS "seq!" FROM logged CROSS JOIN restored
            WHERE restored.value IS NOT NULL"#,
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
/// Counter row waits are capped at 50 ms, preserving stricter settings;
/// the previous setting is restored after all log rows have been inserted.
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
    // As in the scalar append, allocation depends on configuration and the
    // restoration barrier consumes the full batch before returning any receipt.
    let rows = sqlx::query!(
        r#"
            WITH saved AS MATERIALIZED (
                SELECT current_setting('lock_timeout') AS value
            ), configured AS MATERIALIZED (
                SELECT set_config('lock_timeout', CASE
                    WHEN value::interval > interval '0'
                        AND value::interval < interval '50 milliseconds' THEN value
                    ELSE '50ms' END, true) AS value
                FROM saved
            ), pending AS MATERIALIZED (
                SELECT channel_id, activity_id,
                       row_number() OVER (PARTITION BY channel_id ORDER BY ordinal) AS position,
                       count(*) OVER (PARTITION BY channel_id) AS total
                FROM UNNEST($1::uuid[], $2::uuid[]) WITH ORDINALITY
                    AS input(channel_id, activity_id, ordinal)
            ), advanced AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                SELECT channel_id, total FROM pending CROSS JOIN configured
                WHERE configured.value IS NOT NULL
                GROUP BY channel_id, total ORDER BY channel_id
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + EXCLUDED.seq,
                    updated_at = clock_timestamp()
                RETURNING channel_id, seq
            ), logged AS (
                INSERT INTO channel_change_log (channel_id, seq, kind, activity_id)
                SELECT pending.channel_id, advanced.seq - pending.total + pending.position,
                       2, pending.activity_id
                FROM pending JOIN advanced USING (channel_id)
                ORDER BY pending.channel_id, pending.position
                RETURNING activity_id, seq
            ), restored AS MATERIALIZED (
                SELECT set_config('lock_timeout', saved.value, true) AS value
                FROM saved CROSS JOIN (SELECT count(*) AS completed FROM logged) done
                WHERE done.completed > 0
            )
            SELECT logged.activity_id AS "activity_id!", logged.seq AS "seq!"
            FROM logged CROSS JOIN restored WHERE restored.value IS NOT NULL
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
