//! Appending to a channel's change log inside the transaction that made the
//! change, and reading the log back.

use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{PgMessageRepository, database_error};
use crate::domain::{
    changes::{
        ChannelActivityLog, ChannelChange, ChannelChangeLog, ChannelChangeLogPruner,
        ChannelChangeOp,
    },
    models::MessageParent,
    ports::MessageError,
};

#[cfg(test)]
mod test;

const KIND_MESSAGE: i16 = 1;
const KIND_HISTORY_IMPORTED: i16 = 2;
const KIND_ACTIVITY: i16 = 3;
/// How long a write waits in the database for the writes to its channel
/// ahead of it. The write gate keeps that queue a few writers long, so only a
/// stalled transaction makes a writer wait this long; without the bound it
/// would park every later writer to its channel on a pool connection until
/// the database ended the stalled session.
const COUNTER_LOCK_TIMEOUT: &str = "5s";

fn internal(message: &'static str) -> MessageError {
    MessageError::Repository(rootcause::report!(message).into())
}

/// Log one change to a message when its parent is a channel, and return its
/// sequence number. Other parents keep no log.
///
/// Call it last, immediately before the commit: the counter row is the only
/// lock two writers to one channel share, so taking it last keeps it held for
/// the commit alone, and no writer waits for another lock while holding it.
pub(super) async fn append_message(
    tx: &mut Transaction<'_, Postgres>,
    parent: &MessageParent,
    message_id: Uuid,
    root_id: Uuid,
) -> Result<Option<i64>, MessageError> {
    let MessageParent::Channel(channel_id) = parent else {
        return Ok(None);
    };
    append(
        tx,
        *channel_id,
        &[ChannelChangeOp::Message {
            message_id,
            root_id,
        }],
    )
    .await
    .map(Some)
}

/// Check a new reply's reference to its root now instead of at commit.
///
/// The reference is a deferred foreign key, and its check locks the root's
/// row. Left to the commit it would run while this transaction holds the
/// channel's counter, and deadlock with a writer that holds the root and
/// waits for the counter. Call it before [`append_message`] whenever the
/// transaction inserted a reply.
pub(super) async fn check_thread_references(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), MessageError> {
    sqlx::query!("SET CONSTRAINTS comms_messages_thread_parent_fkey IMMEDIATE")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    Ok(())
}

/// Let later statements of the transaction defer the reply reference again.
pub(super) async fn defer_thread_references(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<(), MessageError> {
    sqlx::query!("SET CONSTRAINTS comms_messages_thread_parent_fkey DEFERRED")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    Ok(())
}

/// Append `ops` to the channel's log as one contiguous block and return the
/// sequence number of the last one.
pub(super) async fn append(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    ops: &[ChannelChangeOp],
) -> Result<i64, MessageError> {
    let count =
        i64::try_from(ops.len()).map_err(|_| internal("channel change block is too large"))?;
    if count == 0 {
        return Err(internal("channel change block is empty"));
    }
    let mut kinds = Vec::with_capacity(ops.len());
    let mut message_ids = Vec::with_capacity(ops.len());
    let mut root_ids = Vec::with_capacity(ops.len());
    let mut activity_ids = Vec::with_capacity(ops.len());
    for op in ops {
        let (kind, message_id, root_id, activity_id) = match *op {
            ChannelChangeOp::Message {
                message_id,
                root_id,
            } => (KIND_MESSAGE, Some(message_id), Some(root_id), None),
            ChannelChangeOp::HistoryImported => (KIND_HISTORY_IMPORTED, None, None, None),
            ChannelChangeOp::Activity(id) => (KIND_ACTIVITY, None, None, Some(id)),
        };
        kinds.push(kind);
        message_ids.push(message_id);
        root_ids.push(root_id);
        activity_ids.push(activity_id);
    }
    // One statement: the wait is bounded, the channel's turn is taken, then
    // the counter moves and the rows take the numbers it handed out. Each
    // step reads from the one before, so they run in this order.
    //
    // The turn is an advisory lock because its queue is one wait the timeout
    // covers. Writers queued on the counter row alone re-queue after every
    // commit ahead of them, so a row-lock timeout never bounds their total
    // wait, and a flooded channel holds every pool connection.
    let seqs = sqlx::query_scalar!(
        r#"
        WITH bounded AS MATERIALIZED (
            SELECT set_config('lock_timeout', $7, true) AS lock_timeout
        ),
        turn AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(hashtextextended('channel_change:' || $1::uuid::text, 0))
            FROM bounded
        ),
        bumped AS (
            INSERT INTO comms_channel_change_counters (channel_id, seq)
            SELECT $1::uuid, $2::bigint FROM turn
            ON CONFLICT (channel_id) DO UPDATE
            SET seq = comms_channel_change_counters.seq + EXCLUDED.seq,
                updated_at = now()
            RETURNING seq
        )
        INSERT INTO comms_channel_change_log
            (channel_id, seq, kind, message_id, root_id, activity_id)
        SELECT $1, bumped.seq - $2 + change.position, change.kind, change.message_id,
            change.root_id, change.activity_id
        FROM bumped,
            unnest($3::smallint[], $4::uuid[], $5::uuid[], $6::uuid[])
                WITH ORDINALITY AS change(kind, message_id, root_id, activity_id, position)
        RETURNING seq
        "#,
        channel_id,
        count,
        &kinds,
        &message_ids as &[Option<Uuid>],
        &root_ids as &[Option<Uuid>],
        &activity_ids as &[Option<Uuid>],
        COUNTER_LOCK_TIMEOUT,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(database_error)?;
    let last = seqs
        .into_iter()
        .max()
        .ok_or_else(|| internal("channel change block logged nothing"))?;
    Ok(last)
}

fn op_from_row(
    kind: i16,
    message_id: Option<Uuid>,
    root_id: Option<Uuid>,
    activity_id: Option<Uuid>,
) -> Result<ChannelChangeOp, MessageError> {
    match (kind, message_id, root_id, activity_id) {
        (KIND_MESSAGE, Some(message_id), Some(root_id), None) => Ok(ChannelChangeOp::Message {
            message_id,
            root_id,
        }),
        (KIND_HISTORY_IMPORTED, None, None, None) => Ok(ChannelChangeOp::HistoryImported),
        (KIND_ACTIVITY, None, None, Some(id)) => Ok(ChannelChangeOp::Activity(id)),
        _ => Err(internal(
            "channel change log row has an unknown kind or target",
        )),
    }
}

impl PgMessageRepository {
    pub(super) async fn read_channel_seq(&self, channel_id: Uuid) -> Result<i64, MessageError> {
        let seq = sqlx::query_scalar!(
            "SELECT seq FROM comms_channel_change_counters WHERE channel_id = $1",
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(seq.unwrap_or(0))
    }

    pub(super) async fn read_channel_change_log(
        &self,
        channel_id: Uuid,
        since: i64,
        limit: usize,
    ) -> Result<ChannelChangeLog, MessageError> {
        let limit =
            i64::try_from(limit).map_err(|_| internal("channel change page limit is too large"))?;
        // One statement, so the counter and the rows come from one snapshot
        // and the counter never trails the rows read. Rows are read only
        // when the one right after the reader's number is still kept: a
        // reader behind retention is answered by that single probe instead
        // of a walk over what retention removed.
        let rows = sqlx::query!(
            r#"
            SELECT
                COALESCE(counter.seq, 0) AS "counter!",
                change.seq AS "seq?",
                change.kind AS "kind?",
                change.message_id AS "message_id?",
                change.root_id AS "root_id?",
                change.activity_id AS "activity_id?"
            FROM (SELECT $1::uuid AS channel_id) channel
            LEFT JOIN comms_channel_change_counters counter
                ON counter.channel_id = channel.channel_id
            LEFT JOIN LATERAL (
                SELECT log.seq, log.kind, log.message_id, log.root_id, log.activity_id
                FROM comms_channel_change_log log
                WHERE log.channel_id = channel.channel_id
                  AND log.seq > $2
                  AND EXISTS (
                      SELECT 1 FROM comms_channel_change_log next
                      WHERE next.channel_id = channel.channel_id AND next.seq = $4
                  )
                ORDER BY log.seq
                LIMIT $3
            ) change ON true
            ORDER BY change.seq
            "#,
            channel_id,
            since,
            limit,
            since.saturating_add(1),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        let mut log = ChannelChangeLog::default();
        for row in rows {
            log.counter = row.counter;
            if let (Some(seq), Some(kind)) = (row.seq, row.kind) {
                log.changes.push(ChannelChange {
                    seq,
                    op: op_from_row(kind, row.message_id, row.root_id, row.activity_id)?,
                });
            }
        }
        Ok(log)
    }
}

impl ChannelActivityLog for PgMessageRepository {
    #[tracing::instrument(skip(self, activity_ids), fields(count = activity_ids.len()), err(Debug))]
    async fn record_activities(
        &self,
        channel_id: Uuid,
        activity_ids: &[Uuid],
    ) -> Result<Option<i64>, MessageError> {
        let ops: Vec<_> = activity_ids
            .iter()
            .map(|id| ChannelChangeOp::Activity(*id))
            .collect();
        let _turn = self.gate.enter_channel(channel_id).await?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        // A fact can arrive after its channel was deleted. Holding the
        // channel row, as a message write does, also keeps a concurrent
        // deletion from reaching the counter first.
        let exists = sqlx::query_scalar!(
            "SELECT id FROM comms_channels WHERE id = $1 FOR KEY SHARE",
            channel_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?;
        if exists.is_none() {
            return Ok(None);
        }
        let seq = append(&mut tx, channel_id, &ops).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(Some(seq))
    }
}

impl ChannelChangeLogPruner for PgMessageRepository {
    #[tracing::instrument(skip(self), err(Debug))]
    async fn prune_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> Result<usize, MessageError> {
        let limit = i64::try_from(batch)
            .map_err(|_| internal("channel change prune batch is too large"))?;
        let removed = sqlx::query!(
            r#"
            WITH doomed AS (
                SELECT channel_id, seq
                FROM comms_channel_change_log
                WHERE created_at < $1
                ORDER BY created_at, channel_id, seq
                LIMIT $2
            )
            DELETE FROM comms_channel_change_log log
            USING doomed
            WHERE log.channel_id = doomed.channel_id
              AND log.seq = doomed.seq
            "#,
            cutoff,
            limit,
        )
        .execute(&self.pool)
        .await
        .map_err(database_error)?
        .rows_affected();
        usize::try_from(removed).map_err(|_| internal("pruned row count overflows"))
    }
}
