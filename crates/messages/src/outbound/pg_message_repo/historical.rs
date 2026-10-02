use std::collections::HashSet;

use sqlx::Acquire;

use super::{PgMessageRepository, database_error};
use crate::domain::{
    historical::{HistoricalBatch, HistoricalMessage},
    ports::{HistoricalMessageRepository, MessageError},
};

#[cfg(test)]
mod test;

impl crate::domain::ports::HistoricalMessageReader for PgMessageRepository {
    async fn lookup_historical_targets(
        &self,
        ids: &[uuid::Uuid],
    ) -> Result<Vec<crate::domain::historical::HistoricalMessageTarget>, MessageError> {
        use crate::domain::historical::{HistoricalMessageTarget, MAX_HISTORICAL_MESSAGES};
        if ids.len() > MAX_HISTORICAL_MESSAGES {
            return Err(MessageError::Invalid("too many reference targets"));
        }
        sqlx::query_as!(
            HistoricalMessageTarget,
            r#"SELECT m.id AS message_id, m.channel_id AS "channel_id!", t.root_id
               FROM comms_messages m
               JOIN comms_message_threads t ON t.root_id = coalesce(m.thread_id, m.id)
               JOIN comms_messages root ON root.id = t.root_id
               WHERE m.id = ANY($1) AND m.deleted_at IS NULL AND t.deleted_at IS NULL
                 AND root.deleted_at IS NULL AND root.thread_id IS NULL
                 AND m.parent_entity_type = 'channel' AND m.parent_entity_id = m.channel_id::text
                 AND t.parent_entity_type = 'channel' AND t.parent_entity_id = m.channel_id::text
                 AND root.channel_id = m.channel_id AND root.parent_entity_type = 'channel'
                 AND root.parent_entity_id = m.channel_id::text"#,
            ids,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)
    }
}

impl HistoricalMessageRepository for PgMessageRepository {
    async fn insert_historical(&self, batch: &HistoricalBatch) -> Result<(), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::insert_historical_in(&mut tx, batch).await?;
        tx.commit().await.map_err(database_error)
    }
}

impl PgMessageRepository {
    /// Patch only an unchanged, undeleted importer-written body. Live edits (even
    /// edit/revert) invalidate the timestamp guard. No timestamp, thread, reaction,
    /// author or activity is changed and no live-message effects are emitted.
    pub async fn patch_historical_body_in(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        patch: &crate::domain::historical::HistoricalBodyPatch,
    ) -> Result<bool, MessageError> {
        if patch.body.trim().is_empty()
            || patch.body.len() > crate::domain::historical::MAX_HISTORICAL_MESSAGE_BYTES
        {
            return Err(MessageError::Invalid("invalid historical body patch"));
        }
        let guard = serde_json::json!({
            "slack_import_job": patch.job_id,
            "body_version": patch.importer_version,
        });
        Ok(sqlx::query!(
            r#"UPDATE comms_messages SET content = $5
               WHERE id = $1 AND channel_id = $2
                 AND parent_entity_type = 'channel' AND parent_entity_id = $2::text
                 AND content = $3 AND content <> $5 AND import_metadata @> $4
                 AND deleted_at IS NULL AND edited_at IS NULL AND updated_at = created_at
                 AND NOT EXISTS (SELECT 1 FROM comms_message_threads t
                     WHERE t.root_id = coalesce(comms_messages.thread_id, comms_messages.id)
                       AND t.deleted_at IS NOT NULL)"#,
            patch.message_id,
            patch.channel_id,
            patch.expected_body,
            guard,
            patch.body,
        )
        .execute(&mut **tx)
        .await
        .map_err(database_error)?
        .rows_affected()
            == 1)
    }

    /// Persist historical channel messages in a caller-owned transaction without
    /// publishing effects or committing that transaction. The composition root
    /// must authorize the channel and atomically persist its source mappings,
    /// fenced checkpoint, counters and dirty-search marker in the same transaction.
    ///
    /// A savepoint makes even late reaction failures roll back the whole batch.
    /// Existing message IDs are conflicts, not permission to change old content;
    /// the caller must resolve source deduplication before invoking this helper.
    pub async fn insert_historical_in(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        batch: &HistoricalBatch,
    ) -> Result<(), MessageError> {
        batch.validate()?;
        let mut batch_tx = tx.begin().await.map_err(database_error)?;
        let result = insert_batch(&mut batch_tx, batch).await;
        match result {
            Ok(()) => batch_tx.commit().await.map_err(database_error),
            Err(error) => {
                batch_tx.rollback().await.map_err(database_error)?;
                Err(error)
            }
        }
    }
}

async fn insert_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    batch: &HistoricalBatch,
) -> Result<(), MessageError> {
    let (roots, replies): (Vec<_>, Vec<_>) = batch
        .messages
        .iter()
        .partition(|message| message.thread_id.is_none());
    insert_messages(tx, batch.channel_id, &roots).await?;

    let root_ids: Vec<_> = replies
        .iter()
        .filter_map(|message| message.thread_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !root_ids.is_empty() {
        // Lock both structural and message state until the caller commits, so a
        // concurrent tombstone cannot invalidate this ownership check.
        let roots = sqlx::query!(
            r#"SELECT t.root_id FROM comms_message_threads t
               JOIN comms_messages m ON m.id = t.root_id
               WHERE t.root_id = ANY($1) AND t.parent_entity_type = 'channel'
                   AND t.parent_entity_id = $2 AND m.channel_id = $3
                   AND m.thread_id IS NULL AND m.deleted_at IS NULL AND t.deleted_at IS NULL
               ORDER BY t.root_id FOR UPDATE OF t, m"#,
            &root_ids,
            batch.channel_id.to_string(),
            batch.channel_id,
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(database_error)?;
        if roots.len() != root_ids.len() {
            return Err(MessageError::Invalid(
                "historical reply must name a live root in its channel",
            ));
        }
    }
    insert_messages(tx, batch.channel_id, &replies).await?;
    insert_reactions(tx, batch).await?;
    insert_mentions(tx, batch).await
}

async fn insert_messages(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    channel_id: uuid::Uuid,
    messages: &[&HistoricalMessage],
) -> Result<(), MessageError> {
    if messages.is_empty() {
        return Ok(());
    }
    let ids: Vec<_> = messages.iter().map(|message| message.id).collect();
    let threads: Vec<_> = messages.iter().map(|message| message.thread_id).collect();
    let senders: Vec<_> = messages
        .iter()
        .map(|message| message.sender.as_ref())
        .collect();
    let authors: Vec<_> = messages
        .iter()
        .map(|message| message.imported_author.as_deref())
        .collect();
    let content: Vec<_> = messages
        .iter()
        .map(|message| message.content.as_str())
        .collect();
    let created: Vec<_> = messages.iter().map(|message| message.created_at).collect();
    let updated: Vec<_> = messages.iter().map(|message| message.updated_at).collect();
    let edited: Vec<_> = messages
        .iter()
        .map(|message| message.edited_at.map(|time| time.naive_utc()))
        .collect();
    let metadata: Vec<_> = messages
        .iter()
        .map(|message| message.import_metadata.clone())
        .collect();
    let order: Vec<_> = messages
        .iter()
        .map(|message| message.import_order)
        .collect();
    // Separate root/reply statements allow the root-thread trigger to run first.
    // Its created_at/updated_at values come from these backdated message columns.
    let result = sqlx::query!(
        r#"INSERT INTO comms_messages
               (id, channel_id, parent_entity_type, parent_entity_id, thread_id,
                sender_id, imported_author, content, created_at, updated_at, edited_at,
                import_metadata, import_order)
           SELECT input.id, $1, 'channel', $2, input.thread_id, input.sender_id,
               input.imported_author, input.content, input.created_at, input.updated_at,
               input.edited_at, input.import_metadata, input.import_order
           FROM UNNEST($3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::text[],
               $8::timestamptz[], $9::timestamptz[], $10::timestamp[], $11::jsonb[], $12::bigint[])
               AS input(id, thread_id, sender_id, imported_author, content, created_at,
                        updated_at, edited_at, import_metadata, import_order)
           ON CONFLICT (id) DO NOTHING"#,
        channel_id,
        channel_id.to_string(),
        &ids,
        &threads as _,
        &senders as _,
        &authors as _,
        &content as _,
        &created,
        &updated,
        &edited as _,
        &metadata,
        &order,
    )
    .execute(&mut **tx)
    .await
    .map_err(database_error)?;
    if result.rows_affected() != messages.len() as u64 {
        return Err(MessageError::Conflict);
    }
    Ok(())
}

async fn insert_reactions(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    batch: &HistoricalBatch,
) -> Result<(), MessageError> {
    let mut messages = Vec::new();
    let mut users = Vec::new();
    let mut emoji = Vec::new();
    let mut created = Vec::new();
    for message in &batch.messages {
        for reaction in &message.reactions {
            messages.push(message.id);
            users.push(reaction.user_id.as_ref());
            emoji.push(reaction.emoji.as_str());
            created.push(reaction.created_at);
        }
    }
    if messages.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"INSERT INTO comms_reactions (message_id, user_id, emoji, created_at)
           SELECT input.message_id, input.user_id, input.emoji, input.created_at
           FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::timestamptz[])
               AS input(message_id, user_id, emoji, created_at)
           ON CONFLICT (message_id, emoji, user_id) DO NOTHING"#,
        &messages,
        &users as _,
        &emoji as _,
        &created,
    )
    .execute(&mut **tx)
    .await
    .map_err(database_error)?;
    Ok(())
}

async fn insert_mentions(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    batch: &HistoricalBatch,
) -> Result<(), MessageError> {
    let mut ids = Vec::new();
    let mut messages = Vec::new();
    let mut users = Vec::new();
    let mut senders = Vec::new();
    let mut created = Vec::new();
    for message in &batch.messages {
        let mut mentioned = HashSet::new();
        for mention in &message.mentions {
            if mentioned.insert(&mention.user_id) {
                ids.push(mention.id);
                messages.push(message.id.to_string());
                users.push(mention.user_id.as_ref());
                senders.push(message.sender.as_ref());
                created.push(message.created_at);
            }
        }
    }
    if ids.is_empty() {
        return Ok(());
    }
    let result = sqlx::query!(
        r#"INSERT INTO comms_entity_mentions
               (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at)
           SELECT input.id, 'message', input.message_id, 'user', input.user_id,
               input.sender_id, input.created_at
           FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])
               AS input(id, message_id, user_id, sender_id, created_at)
           ON CONFLICT (id) DO NOTHING"#,
        &ids,
        &messages,
        &users as _,
        &senders as _,
        &created,
    )
    .execute(&mut **tx)
    .await
    .map_err(database_error)?;
    if result.rows_affected() != ids.len() as u64 {
        return Err(MessageError::Invalid(
            "historical mention id already exists",
        ));
    }
    Ok(())
}
