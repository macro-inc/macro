use crate::domain::{
    models::{
        ChannelAttachment, ChannelParticipant, CountedReaction, MessageAttachment, ParticipantRole,
        ThreadData, ThreadReplyRow, TopLevelMessageRow,
    },
    ports::ChannelMessagesRepo,
};
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
#[derive(Debug, sqlx::FromRow)]
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
#[derive(Debug, sqlx::FromRow)]
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

/// Intermediate row for reactions.
#[derive(Debug, sqlx::FromRow)]
struct ReactionRow {
    message_id: Uuid,
    emoji: String,
    user_id: String,
}

/// Intermediate row for attachments.
#[derive(Debug, sqlx::FromRow)]
struct AttachmentRow {
    id: Uuid,
    message_id: Uuid,
    entity_type: String,
    entity_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for channel-level attachments.
#[derive(Debug, sqlx::FromRow)]
struct ChannelAttachmentRow {
    id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
    entity_type: String,
    entity_id: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for channel participants.
#[derive(Debug, sqlx::FromRow)]
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
        limit: u16,
    ) -> Result<Vec<TopLevelMessageRow>, Self::Err> {
        let (cursor_created_at, cursor_id) = match query.vals() {
            (Some(id), Some(val)) => (Some(*val), Some(*id)),
            _ => (None, None),
        };

        let rows = sqlx::query_as::<_, TopLevelRow>(
            r#"
            SELECT
                m.id,
                m.channel_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.edited_at::timestamptz AS edited_at,
                m.deleted_at::timestamptz AS deleted_at
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
        )
        .bind(channel_id)
        .bind(cursor_created_at)
        .bind(cursor_id)
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
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
            .collect())
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

        let rows = sqlx::query_as::<_, ThreadDataRow>(
            r#"
            SELECT
                id, thread_id, sender_id, content, created_at, updated_at,
                edited_at::timestamptz AS edited_at,
                reply_count, latest_reply_at
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
                    ROW_NUMBER() OVER (PARTITION BY r.thread_id ORDER BY r.created_at DESC) AS rn
                FROM comms_messages r
                WHERE r.thread_id = ANY($1) AND r.deleted_at IS NULL
            ) sub
            WHERE rn <= $2
            ORDER BY thread_id, created_at ASC
            "#,
        )
        .bind(parent_ids)
        .bind(i64::from(preview_count))
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
    async fn get_reactions_batch(
        &self,
        message_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<CountedReaction>>, Self::Err> {
        if message_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query_as::<_, ReactionRow>(
            r#"
            SELECT message_id, emoji, user_id
            FROM comms_reactions
            WHERE message_id = ANY($1)
            ORDER BY created_at ASC
            "#,
        )
        .bind(message_ids)
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

        let rows = sqlx::query_as::<_, AttachmentRow>(
            r#"
            SELECT id, message_id, entity_type, entity_id, created_at
            FROM comms_attachments
            WHERE message_id = ANY($1)
            ORDER BY created_at ASC
            "#,
        )
        .bind(message_ids)
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

        let rows = sqlx::query_as::<_, ChannelAttachmentRow>(
            r#"
            SELECT id, channel_id, message_id, entity_type, entity_id, width, height, created_at
            FROM comms_attachments
            WHERE channel_id = $1
              AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
            ORDER BY created_at DESC, id DESC
            LIMIT $4
            "#,
        )
        .bind(channel_id)
        .bind(cursor_created_at)
        .bind(cursor_id)
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ChannelAttachment {
                id: r.id,
                channel_id: r.channel_id,
                message_id: r.message_id,
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
        let rows = sqlx::query_as::<_, ParticipantRow>(
            r#"
            SELECT channel_id, user_id, role::text AS role, joined_at, left_at
            FROM comms_channel_participants
            WHERE channel_id = $1 AND left_at IS NULL
            ORDER BY joined_at ASC
            "#,
        )
        .bind(channel_id)
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
}
