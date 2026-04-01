#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        ChannelAttachment, ChannelParticipant, CountedReaction, MessageAttachment,
        MessagePageDirection, ParticipantRole, ThreadData, ThreadReplyRow, TopLevelMessageRow,
    },
    ports::{ChannelMessagesRepo, TopLevelMessagesQueryResult},
};
use chrono::{DateTime, Utc};
use models_pagination::{CreatedAt, Query};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Postgres-backed repository for channel messages.
pub struct PgChannelMessagesRepo {
    pool: PgPool,
}

impl PgChannelMessagesRepo {
    /// Create a new repo with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Intermediate row for the top-level messages query.
#[derive(Debug)]
struct TopLevelRow {
    id: Uuid,
    channel_id: Uuid,
    sender_id: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Intermediate row for the merged thread data query (stats + preview replies).
#[derive(Debug)]
struct ThreadDataRow {
    id: Uuid,
    thread_id: Uuid,
    sender_id: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
    reply_count: i64,
    latest_reply_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Intermediate row for full thread replies query.
#[derive(Debug, sqlx::FromRow)]
struct ThreadReplyOnlyRow {
    id: Uuid,
    thread_id: Uuid,
    sender_id: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Intermediate row for reactions.
#[derive(Debug)]
struct ReactionRow {
    message_id: Uuid,
    emoji: String,
    user_id: String,
}

/// Intermediate row for attachments.
#[derive(Debug)]
struct AttachmentRow {
    id: Uuid,
    message_id: Uuid,
    entity_type: String,
    entity_id: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for channel-level attachments.
#[derive(Debug)]
struct ChannelAttachmentRow {
    id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
    sender_id: String,
    entity_type: String,
    entity_id: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for channel participants.
#[derive(Debug)]
struct ParticipantRow {
    channel_id: Uuid,
    user_id: String,
    role: String,
    joined_at: chrono::DateTime<chrono::Utc>,
    left_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ChannelMessagesRepo for PgChannelMessagesRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_top_level_messages(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
    ) -> Result<TopLevelMessagesQueryResult, Self::Err> {
        let (cursor_created_at, cursor_id) = match query.vals() {
            (Some(id), Some(val)) => (Some(*val), Some(*id)),
            _ => (None, None),
        };
        let limit_i64 = i64::from(limit);
        let limit_usize = usize::from(limit);

        let (rows, has_more_newer) = match direction {
            MessagePageDirection::Older => {
                let rows = sqlx::query_as!(
                    TopLevelRow,
                    r#"
                    SELECT
                        m.id,
                        m.channel_id,
                        m.sender_id,
                        m.content,
                        m.created_at,
                        m.updated_at,
                        m.edited_at::timestamptz AS "edited_at?",
                        m.deleted_at::timestamptz AS "deleted_at?"
                    FROM comms_messages m
                    WHERE m.channel_id = $1
                      AND m.thread_id IS NULL
                      AND (m.deleted_at IS NULL OR EXISTS (
                          SELECT 1 FROM comms_messages r
                          WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                      ))
                      AND ($2::timestamptz IS NULL OR (m.created_at, m.id) < ($2, $3))
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT $4
                    "#,
                    channel_id,
                    cursor_created_at,
                    cursor_id,
                    limit_i64,
                )
                .fetch_all(&self.pool)
                .await?;

                // For older pagination with a cursor, there is always at least one newer item
                // (the cursor anchor itself) from the API's perspective.
                (rows, cursor_created_at.is_some())
            }
            MessagePageDirection::Newer => {
                // Query in ASC so we can overfetch one newer row and trim while preserving the
                // "nearest newer page" semantics before reversing back to DESC.
                let mut rows = sqlx::query_as!(
                    TopLevelRow,
                    r#"
                    SELECT
                        m.id,
                        m.channel_id,
                        m.sender_id,
                        m.content,
                        m.created_at,
                        m.updated_at,
                        m.edited_at::timestamptz AS "edited_at?",
                        m.deleted_at::timestamptz AS "deleted_at?"
                    FROM comms_messages m
                    WHERE m.channel_id = $1
                      AND m.thread_id IS NULL
                      AND (m.deleted_at IS NULL OR EXISTS (
                          SELECT 1 FROM comms_messages r
                          WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                      ))
                      AND ($2::timestamptz IS NOT NULL AND (m.created_at, m.id) > ($2, $3))
                    ORDER BY m.created_at ASC, m.id ASC
                    LIMIT $4
                    "#,
                    channel_id,
                    cursor_created_at,
                    cursor_id,
                    limit_i64 + 1,
                )
                .fetch_all(&self.pool)
                .await?;

                let has_more_newer = rows.len() > limit_usize;
                if has_more_newer {
                    rows.truncate(limit_usize);
                }

                rows.reverse();
                (rows, has_more_newer)
            }
        };

        let rows = rows
            .into_iter()
            .map(|r| TopLevelMessageRow {
                id: r.id,
                channel_id: r.channel_id,
                sender_id: r.sender_id,
                content: r.content,
                created_at: r.created_at,
                updated_at: r.updated_at,
                edited_at: r.edited_at,
                deleted_at: r.deleted_at,
            })
            .collect();

        Ok(TopLevelMessagesQueryResult {
            rows,
            has_more_newer,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_data(
        &self,
        parent_ids: &[Uuid],
        preview_count: u16,
    ) -> Result<HashMap<Uuid, ThreadData>, Self::Err> {
        if parent_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query_as!(
            ThreadDataRow,
            r#"
            SELECT
                id AS "id!", thread_id AS "thread_id!", sender_id AS "sender_id!",
                content AS "content!", created_at AS "created_at!", updated_at AS "updated_at!",
                edited_at::timestamptz AS "edited_at?",
                reply_count AS "reply_count!", latest_reply_at AS "latest_reply_at?"
            FROM (
                SELECT
                    r.id,
                    r.thread_id,
                    r.sender_id,
                    r.content,
                    r.created_at,
                    r.updated_at,
                    r.edited_at,
                    COUNT(*) OVER (PARTITION BY r.thread_id) AS reply_count,
                    MAX(r.created_at) OVER (PARTITION BY r.thread_id)::timestamptz AS latest_reply_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY r.thread_id
                        ORDER BY r.created_at ASC, r.id ASC
                    ) AS rn
                FROM comms_messages r
                WHERE r.thread_id = ANY($1) AND r.deleted_at IS NULL
            ) sub
            WHERE rn <= $2
            ORDER BY thread_id, created_at ASC, id ASC
            "#,
            parent_ids,
            i64::from(preview_count) as i64,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut map: HashMap<Uuid, ThreadData> = HashMap::new();
        for r in rows {
            let entry = map.entry(r.thread_id).or_insert_with(|| ThreadData {
                reply_count: r.reply_count,
                latest_reply_at: r.latest_reply_at,
                preview_replies: Vec::new(),
            });
            entry.preview_replies.push(ThreadReplyRow {
                id: r.id,
                thread_id: r.thread_id,
                sender_id: r.sender_id,
                content: r.content,
                created_at: r.created_at,
                updated_at: r.updated_at,
                edited_at: r.edited_at,
            });
        }

        Ok(map)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_thread_replies(&self, parent_id: Uuid) -> Result<Vec<ThreadReplyRow>, Self::Err> {
        let rows = sqlx::query_as::<_, ThreadReplyOnlyRow>(
            r#"
            SELECT
                id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                edited_at::timestamptz AS edited_at
            FROM comms_messages
            WHERE thread_id = $1
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            "#,
        )
        .bind(parent_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ThreadReplyRow {
                id: r.id,
                thread_id: r.thread_id,
                sender_id: r.sender_id,
                content: r.content,
                created_at: r.created_at,
                updated_at: r.updated_at,
                edited_at: r.edited_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_reactions_batch(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<CountedReaction>>, Self::Err> {
        if message_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query_as!(
            ReactionRow,
            r#"
            SELECT message_id, emoji, user_id
            FROM comms_reactions
            WHERE message_id = ANY($1)
            ORDER BY created_at ASC
            "#,
            message_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        // Group by message_id, then fold by emoji within each message.
        let mut map: HashMap<Uuid, HashMap<String, Vec<String>>> = HashMap::new();
        for r in rows {
            map.entry(r.message_id)
                .or_default()
                .entry(r.emoji)
                .or_default()
                .push(r.user_id);
        }

        Ok(map
            .into_iter()
            .map(|(msg_id, emoji_map)| {
                let reactions = emoji_map
                    .into_iter()
                    .map(|(emoji, users)| CountedReaction { emoji, users })
                    .collect();
                (msg_id, reactions)
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_attachments_batch(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<MessageAttachment>>, Self::Err> {
        if message_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query_as!(
            AttachmentRow,
            r#"
            SELECT id, message_id, entity_type, entity_id,
                   width AS "width?", height AS "height?", created_at
            FROM comms_attachments
            WHERE message_id = ANY($1)
            ORDER BY created_at ASC
            "#,
            message_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        for r in rows {
            map.entry(r.message_id)
                .or_default()
                .push(MessageAttachment {
                    id: r.id,
                    entity_type: r.entity_type,
                    entity_id: r.entity_id,
                    width: r.width,
                    height: r.height,
                    created_at: r.created_at,
                });
        }

        Ok(map)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> Result<Vec<ChannelAttachment>, Self::Err> {
        let (cursor_created_at, cursor_id) = match query.vals() {
            (Some(id), Some(val)) => (Some(*val), Some(*id)),
            _ => (None, None),
        };

        let rows = sqlx::query_as!(
            ChannelAttachmentRow,
            r#"
            SELECT a.id, a.channel_id, a.message_id, m.sender_id,
                a.entity_type, a.entity_id,
                a.width AS "width?", a.height AS "height?", a.created_at
            FROM comms_attachments a
            JOIN comms_messages m ON m.id = a.message_id
            WHERE a.channel_id = $1
              AND m.deleted_at IS NULL
              AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2, $3))
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $4
            "#,
            channel_id,
            cursor_created_at,
            cursor_id,
            i64::from(limit) as i64,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ChannelAttachment {
                id: r.id,
                channel_id: r.channel_id,
                message_id: r.message_id,
                sender_id: r.sender_id,
                entity_type: r.entity_type,
                entity_id: r.entity_id,
                width: r.width,
                height: r.height,
                created_at: r.created_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        let rows = sqlx::query_as!(
            ParticipantRow,
            r#"
            SELECT channel_id, user_id, role::text AS "role!", joined_at,
                left_at AS "left_at?"
            FROM comms_channel_participants
            WHERE channel_id = $1 AND left_at IS NULL
            ORDER BY joined_at ASC
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ChannelParticipant {
                channel_id: r.channel_id,
                user_id: r.user_id,
                role: r
                    .role
                    .parse::<ParticipantRole>()
                    .unwrap_or(ParticipantRole::Member),
                joined_at: r.joined_at,
                left_at: r.left_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn resolve_top_level_parent(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<TopLevelMessageRow>, Self::Err> {
        let row = sqlx::query_as!(
            TopLevelRow,
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.edited_at::timestamptz AS "edited_at?",
                m.deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages m
            WHERE m.id = COALESCE(
                (SELECT thread_id FROM comms_messages WHERE id = $1 AND channel_id = $2),
                $1
            )
            AND m.channel_id = $2
            AND m.thread_id IS NULL
            "#,
            message_id,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| TopLevelMessageRow {
            id: r.id,
            channel_id: r.channel_id,
            sender_id: r.sender_id,
            content: r.content,
            created_at: r.created_at,
            updated_at: r.updated_at,
            edited_at: r.edited_at,
            deleted_at: r.deleted_at,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_top_level_messages_around(
        &self,
        channel_id: Uuid,
        anchor_created_at: DateTime<Utc>,
        anchor_id: Uuid,
        limit: u16,
    ) -> Result<(Vec<TopLevelMessageRow>, Vec<TopLevelMessageRow>), Self::Err> {
        let limit_i64 = i64::from(limit);

        let before_fut = sqlx::query_as!(
            TopLevelRow,
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.edited_at::timestamptz AS "edited_at?",
                m.deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages m
            WHERE m.channel_id = $1
              AND m.thread_id IS NULL
              AND (m.deleted_at IS NULL OR EXISTS (
                  SELECT 1 FROM comms_messages r
                  WHERE r.thread_id = m.id AND r.deleted_at IS NULL
              ))
              AND (m.created_at, m.id) < ($2, $3)
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $4
            "#,
            channel_id,
            anchor_created_at,
            anchor_id,
            limit_i64,
        )
        .fetch_all(&self.pool);

        let after_fut = sqlx::query_as!(
            TopLevelRow,
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.edited_at::timestamptz AS "edited_at?",
                m.deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages m
            WHERE m.channel_id = $1
              AND m.thread_id IS NULL
              AND (m.deleted_at IS NULL OR EXISTS (
                  SELECT 1 FROM comms_messages r
                  WHERE r.thread_id = m.id AND r.deleted_at IS NULL
              ))
              AND (m.created_at, m.id) > ($2, $3)
            ORDER BY m.created_at ASC, m.id ASC
            LIMIT $4
            "#,
            channel_id,
            anchor_created_at,
            anchor_id,
            limit_i64,
        )
        .fetch_all(&self.pool);

        let (before_rows, after_rows): (Vec<TopLevelRow>, Vec<TopLevelRow>) =
            tokio::try_join!(before_fut, after_fut)?;

        let to_row = |r: TopLevelRow| TopLevelMessageRow {
            id: r.id,
            channel_id: r.channel_id,
            sender_id: r.sender_id,
            content: r.content,
            created_at: r.created_at,
            updated_at: r.updated_at,
            edited_at: r.edited_at,
            deleted_at: r.deleted_at,
        };

        let before: Vec<TopLevelMessageRow> = before_rows.into_iter().map(to_row).collect();
        let after: Vec<TopLevelMessageRow> = after_rows.into_iter().map(to_row).collect();

        Ok((before, after))
    }
}
