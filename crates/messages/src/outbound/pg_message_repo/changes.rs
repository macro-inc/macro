//! Bounded channel log reads, current-state hydration, and retention.

use super::*;
use crate::domain::changes::{
    ChannelChange, ChannelChangeKind, ChannelChangeLog, ChannelChangeLogPruner,
    ChannelMessageChange, MAX_CHANNEL_CHANGE_LAG, MAX_CHANNEL_CHANGE_ROWS,
};

#[cfg(test)]
mod test;

impl PgMessageRepository {
    pub(super) async fn read_channel_seq(&self, channel_id: Uuid) -> Result<i64, MessageError> {
        channel_change_db_utils::current_seq(&self.pool, channel_id)
            .await
            .map_err(database_error)
    }

    #[tracing::instrument(name = "messages.read_channel_change_log", skip_all, fields(%channel_id, after), err)]
    pub(super) async fn read_channel_change_log(
        &self,
        channel_id: Uuid,
        after: i64,
    ) -> Result<ChannelChangeLog, MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let stored = channel_change_db_utils::read_log(
            &mut tx,
            channel_id,
            after,
            MAX_CHANNEL_CHANGE_LAG as i64,
            MAX_CHANNEL_CHANGE_LAG as i64 + 1,
        )
        .await
        .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        let mut log = ChannelChangeLog {
            seq: stored.counter,
            floor: stored.floor,
            changes: Vec::new(),
        };
        for row in stored.rows {
            let kind = match (row.kind, row.message_id, row.activity_id) {
                (1, Some(id), None) => ChannelChangeKind::Message(id),
                (2, None, Some(id)) => ChannelChangeKind::Activity(id),
                (3, None, None) => ChannelChangeKind::Reset,
                _ => {
                    return Err(MessageError::Repository(rootcause::report!(
                        "channel change log has an invalid kind or target"
                    )));
                }
            };
            log.changes.push(ChannelChange { seq: row.seq, kind });
        }
        Ok(log)
    }

    #[tracing::instrument(name = "messages.load_channel_message_changes", skip_all, fields(%channel_id, message_count = ids.len() as i64), err)]
    pub(super) async fn read_channel_message_changes(
        &self,
        channel_id: Uuid,
        ids: &[Uuid],
    ) -> Result<Vec<ChannelMessageChange>, MessageError> {
        if ids.len() > MAX_CHANNEL_CHANGE_ROWS {
            return Err(MessageError::Invalid("too many changed message ids"));
        }
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        // Validate both messages and roots in the channel before reusing the
        // normal root hydration, which includes current previews and tombstones.
        let rows = sqlx::query_scalar!(
            r#"
            SELECT to_jsonb(message) AS "message!: Json<StoredMessage>"
            FROM comms_messages message
            JOIN comms_messages root ON root.id = COALESCE(message.thread_id, message.id)
            WHERE message.id = ANY($1)
                AND message.parent_entity_type = 'channel' AND message.parent_entity_id = $2
                AND root.parent_entity_type = 'channel' AND root.parent_entity_id = $2
            ORDER BY array_position($1, message.id)
            "#,
            ids,
            channel_id.to_string(),
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(database_error)?;
        let messages = Self::hydrate_in(&mut tx, rows).await?;
        let mut root_ids = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for message in &messages {
            if seen.insert(message.root_id()) {
                root_ids.push(message.root_id());
            }
        }
        let root_rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>"
            FROM comms_messages m WHERE id = ANY($1) AND thread_id IS NULL
            ORDER BY array_position($1, id)"#,
            &root_ids,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(database_error)?;
        let roots = Self::hydrate_root_rows_in(&mut tx, root_rows).await?;
        tx.commit().await.map_err(database_error)?;
        let mut result: Vec<_> = roots
            .into_iter()
            .map(|message| ChannelMessageChange::Root {
                message: Box::new(message),
                call: None,
            })
            .collect();
        result.extend(
            messages
                .into_iter()
                .filter(|message| message.thread_id.is_some())
                .map(|message| ChannelMessageChange::Reply {
                    message: Box::new(message),
                }),
        );
        Ok(result)
    }
}

impl ChannelChangeLogPruner for PgMessageRepository {
    #[tracing::instrument(name = "messages.prune_channel_change_batch", skip_all, fields(batch = batch as i64, removed = tracing::field::Empty), err)]
    async fn prune_channel_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> Result<usize, MessageError> {
        let limit = i64::try_from(batch)
            .map_err(|_| MessageError::Invalid("channel change prune batch is too large"))?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let removed = channel_change_db_utils::prune_in(&mut tx, cutoff, limit)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        let removed = usize::try_from(removed)
            .map_err(|_| MessageError::Invalid("pruned channel row count overflows"))?;
        tracing::Span::current().record("removed", removed as i64);
        Ok(removed)
    }
}
