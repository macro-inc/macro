//! Postgres context adapter for channel side-effect policy.

use crate::domain::{
    ports::ChannelSideEffectContext,
    side_effects::{ChannelDocumentMention, ThreadNotificationContext},
};
use anyhow::Context;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

struct SenderIdRow {
    sender_id: String,
}

struct UserIdRow {
    user_id: String,
}

struct DocumentMentionRow {
    document_name: String,
    owner: MacroUserIdStr<'static>,
    file_type: Option<String>,
    sub_type: Option<String>,
}

/// Postgres-backed context for channel side-effect policy.
#[derive(Clone)]
pub struct PgChannelSideEffectContext {
    pool: PgPool,
}

impl PgChannelSideEffectContext {
    /// Create a Postgres side-effect context adapter.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ChannelSideEffectContext for PgChannelSideEffectContext {
    type Err = anyhow::Error;

    async fn get_channel_message_count(&self, channel_id: Uuid) -> Result<i64, Self::Err> {
        get_channel_message_count(&self.pool, channel_id).await
    }

    async fn get_existing_user_ids(
        &self,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<HashSet<String>, Self::Err> {
        if user_ids.is_empty() {
            return Ok(HashSet::new());
        }

        let user_ids: Vec<String> = user_ids
            .into_iter()
            .map(|user_id| user_id.as_ref().to_string())
            .collect();
        let existing = sqlx::query_scalar!(
            r#"
            SELECT u.id
            FROM "User" u
            WHERE u.id = ANY($1)
            "#,
            &user_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(existing.into_iter().collect())
    }

    async fn get_document_mentions(
        &self,
        document_ids: Vec<String>,
    ) -> Result<Vec<ChannelDocumentMention>, Self::Err> {
        if document_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mentions = sqlx::query_as!(
            DocumentMentionRow,
            r#"
            SELECT
                d.name AS document_name,
                d.owner AS "owner: MacroUserIdStr",
                d."fileType" AS file_type,
                dst.sub_type::text AS sub_type
            FROM "Document" d
            LEFT JOIN document_sub_type dst ON dst.document_id = d.id
            WHERE d.id = ANY($1)
            "#,
            &document_ids,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(mentions
            .into_iter()
            .map(|mention| ChannelDocumentMention {
                document_name: mention.document_name,
                owner: mention.owner,
                file_type: mention.file_type,
                sub_type: mention.sub_type,
            })
            .collect())
    }

    async fn get_thread_notification_context(
        &self,
        thread_id: Uuid,
    ) -> Result<ThreadNotificationContext, Self::Err> {
        let participants = get_channel_participants_for_thread_id(&self.pool, thread_id).await?;
        let parent_sender_id = get_message_owner(&self.pool, thread_id)
            .await
            .ok()
            .and_then(|id| {
                MacroUserIdStr::parse_from_str(&id)
                    .ok()
                    .map(|id| id.into_owned())
            });

        Ok(ThreadNotificationContext {
            participants,
            parent_sender_id,
        })
    }

    async fn get_sender_profile_picture_url(
        &self,
        sender_id: MacroUserIdStr<'static>,
    ) -> Option<String> {
        get_sender_profile_picture_url(&self.pool, &sender_id).await
    }
}

async fn get_sender_profile_picture_url(
    db: &PgPool,
    sender_id: &MacroUserIdStr<'_>,
) -> Option<String> {
    sqlx::query_scalar!(
        r#"
        SELECT mui.profile_picture as "profile_picture!"
        FROM "User" u
        JOIN macro_user mu ON mu.id = u.macro_user_id
        JOIN macro_user_info mui ON mui.macro_user_id = mu.id
        WHERE u.id = $1
          AND mui.profile_picture IS NOT NULL
        LIMIT 1
        "#,
        sender_id.as_ref(),
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

async fn get_message_owner(pool: &PgPool, message_id: Uuid) -> anyhow::Result<String> {
    let row = sqlx::query_as!(
        SenderIdRow,
        r#"
        SELECT sender_id
        FROM comms_messages
        WHERE id = $1
        ORDER BY created_at ASC
        "#,
        message_id,
    )
    .fetch_one(pool)
    .await
    .context("unable to get message owner")?;
    Ok(row.sender_id)
}

async fn get_channel_message_count(pool: &PgPool, channel_id: Uuid) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(id) AS "count!"
        FROM comms_messages
        WHERE channel_id = $1
        "#,
        channel_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(count)
}

async fn get_channel_participants_for_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> anyhow::Result<Vec<MacroUserIdStr<'static>>> {
    let rows = sqlx::query_as!(
        UserIdRow,
        r#"
        SELECT DISTINCT id AS "user_id!" FROM (
            SELECT m.sender_id AS id
            FROM comms_channel_participants cp
            JOIN comms_channels c ON c.id = cp.channel_id
            JOIN comms_messages m ON m.channel_id = c.id
            WHERE (m.id = $1 OR m.thread_id = $1) AND cp.left_at IS NULL
            UNION
            SELECT em.entity_id AS id
            FROM comms_entity_mentions em
            JOIN comms_messages m ON m.id::text = em.source_entity_id
            JOIN comms_channel_participants cp
              ON cp.channel_id = m.channel_id AND cp.user_id = em.entity_id
            WHERE (m.id = $1 OR m.thread_id = $1)
              AND em.source_entity_type = 'message'
              AND em.entity_type = 'user'
              AND cp.left_at IS NULL
        ) AS combined
        "#,
        thread_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| MacroUserIdStr::try_from(row.user_id).ok())
        .collect())
}
