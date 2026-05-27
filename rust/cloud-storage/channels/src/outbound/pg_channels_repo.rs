#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        ChannelAttachment, ChannelAttachmentType, ChannelContextMessage, ChannelInfo,
        ChannelMessageFilters, ChannelMessageKind, ChannelMetadata, ChannelParticipant,
        ChannelType, CountedReaction, CreateChannelRequest, MessageAttachment,
        MessagePageDirection, MutatedAttachment, MutatedMessage, NewChannelAttachment,
        ParticipantRole, PatchChannelRequest, ResolvedChannelMessage, SimpleMention, ThreadData,
        ThreadReplyRow, TopLevelMessageRow,
    },
    ports::{ChannelRepo, TopLevelMessagesQueryResult},
};
use anyhow::Context;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
use sqlx::{Executor, PgPool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

/// Postgres-backed repository for channels.
#[derive(Clone)]
pub struct PgChannelsRepo {
    pool: PgPool,
}

impl PgChannelsRepo {
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

/// Intermediate row for resolving a message id.
#[derive(Debug, sqlx::FromRow)]
struct ResolvedMessageRow {
    id: Uuid,
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    created_at: chrono::DateTime<chrono::Utc>,
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

/// Intermediate row for grouped reactions.
#[derive(Debug, sqlx::FromRow)]
struct ReactionRow {
    message_id: Uuid,
    emoji: String,
    user_id: String,
}

/// Intermediate row for reactions including the creation timestamp.
#[derive(Debug, sqlx::FromRow)]
struct ReactionWithCreatedAtRow {
    emoji: String,
    user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for attachments.
#[derive(Debug, sqlx::FromRow)]
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
#[derive(Debug, sqlx::FromRow)]
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

/// Intermediate row for message context queries.
#[derive(Debug, sqlx::FromRow)]
struct ContextMessageRow {
    id: Uuid,
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    sender_id: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<ContextMessageRow> for ChannelContextMessage {
    fn from(row: ContextMessageRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            thread_id: row.thread_id,
            sender_id: row.sender_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
        }
    }
}

/// Intermediate row for channel participants.
#[derive(Debug, sqlx::FromRow)]
struct ParticipantRow {
    channel_id: Uuid,
    user_id: String,
    role: ParticipantRole,
    joined_at: chrono::DateTime<chrono::Utc>,
    left_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Intermediate row for mutation-returned messages.
#[derive(Debug, sqlx::FromRow)]
struct MutatedMessageRow {
    id: Uuid,
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    sender_id: MacroUserIdStr<'static>,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    edited_at: Option<chrono::DateTime<chrono::Utc>>,
    deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Intermediate row for mutation-returned attachments.
#[derive(Debug, sqlx::FromRow)]
struct MutatedAttachmentRow {
    id: Uuid,
    channel_id: Uuid,
    message_id: Uuid,
    entity_type: String,
    entity_id: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Intermediate row for channel info.
#[derive(Debug, sqlx::FromRow)]
struct ChannelInfoRow {
    id: Uuid,
    name: Option<String>,
    channel_type: ChannelType,
    org_id: Option<i64>,
    team_id: Option<Uuid>,
}

/// Intermediate row for user display-name lookups.
#[derive(Debug, sqlx::FromRow)]
struct UserDisplayNameRow {
    user_profile_id: String,
    first_name: Option<String>,
    last_name: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct UserIdRow {
    user_id: String,
}

#[derive(Debug, sqlx::FromRow)]
struct MacroUserIdRow {
    user_id: MacroUserIdStr<'static>,
}

#[derive(Debug, sqlx::FromRow)]
struct SenderIdRow {
    sender_id: MacroUserIdStr<'static>,
}

#[derive(Debug, sqlx::FromRow)]
struct ChannelIdRow {
    id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
struct ExistsRow {
    exists: bool,
}

impl From<MutatedMessageRow> for MutatedMessage {
    fn from(row: MutatedMessageRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            thread_id: row.thread_id,
            sender_id: row.sender_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            edited_at: row.edited_at,
            deleted_at: row.deleted_at,
        }
    }
}

impl From<MutatedAttachmentRow> for MutatedAttachment {
    fn from(row: MutatedAttachmentRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            message_id: row.message_id,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            width: row.width,
            height: row.height,
            created_at: row.created_at,
        }
    }
}

fn group_counted_reactions(
    reactions: impl IntoIterator<Item = (String, String, DateTime<Utc>)>,
) -> Vec<CountedReaction> {
    let mut grouped: HashMap<String, (Vec<String>, DateTime<Utc>)> = HashMap::new();
    for (emoji, user_id, created_at) in reactions {
        grouped
            .entry(emoji)
            .and_modify(|(users, earliest_at)| {
                users.push(user_id.clone());
                *earliest_at = std::cmp::min(*earliest_at, created_at);
            })
            .or_insert_with(|| (vec![user_id], created_at));
    }

    let mut counted: Vec<_> = grouped
        .into_iter()
        .map(|(emoji, (users, created_at))| (CountedReaction { emoji, users }, created_at))
        .collect();
    counted.sort_by_key(|(_, created_at)| *created_at);
    counted.into_iter().map(|(reaction, _)| reaction).collect()
}

async fn create_activity<'e, E>(executor: E, channel_id: Uuid, user_id: &str) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
        INSERT INTO comms_activity (id, user_id, channel_id, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        "#,
        macro_uuid::generate_uuid_v7(),
        user_id,
        channel_id,
    )
    .execute(executor)
    .await?;
    Ok(())
}

async fn insert_message_mentions<'e, E>(
    executor: E,
    message_id: Uuid,
    mentions: &[SimpleMention],
) -> anyhow::Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if mentions.is_empty() {
        return Ok(vec![]);
    }

    let entity_types: Vec<_> = mentions
        .iter()
        .map(|mention| mention.entity_type.clone())
        .collect();
    let entity_ids: Vec<_> = mentions
        .iter()
        .map(|mention| mention.entity_id.clone())
        .collect();

    let message_id_text = message_id.to_string();
    let mentioned_users = sqlx::query_as!(
        UserIdRow,
        r#"
        WITH message_channel AS (
            SELECT channel_id FROM comms_messages WHERE id = $1
        ),
        mentions_to_insert AS (
            SELECT t.entity_type, t.entity_id
            FROM UNNEST($2::text[], $3::text[]) AS t(entity_type, entity_id)
        ),
        inserted_mentions AS (
            INSERT INTO comms_entity_mentions (
                id,
                source_entity_type,
                source_entity_id,
                entity_type,
                entity_id,
                user_id
            )
            SELECT gen_random_uuid(), 'message', $4::text, m.entity_type, m.entity_id, NULL
            FROM mentions_to_insert m
            WHERE NOT EXISTS (
                SELECT 1
                FROM comms_entity_mentions em
                WHERE em.source_entity_type = 'message'
                  AND em.source_entity_id = $4::text
                  AND em.entity_type = m.entity_type
                  AND em.entity_id = m.entity_id
            )
        )
        SELECT DISTINCT cp.user_id
        FROM mentions_to_insert m
        CROSS JOIN message_channel mc
        JOIN comms_channel_participants cp ON m.entity_id = cp.user_id
        WHERE m.entity_type = 'user'
          AND cp.channel_id = mc.channel_id
          AND cp.left_at IS NULL
        "#,
        message_id,
        &entity_types,
        &entity_ids,
        message_id_text,
    )
    .fetch_all(executor)
    .await?;

    Ok(mentioned_users.into_iter().map(|row| row.user_id).collect())
}

async fn delete_entity_mentions_by_source<'e, E>(
    executor: E,
    source_entity_ids: &[String],
) -> anyhow::Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE source_entity_id = ANY($1)
        "#,
        source_entity_ids,
    )
    .execute(executor)
    .await?;
    Ok(result.rows_affected())
}

async fn get_message_owner(
    pool: &PgPool,
    channel_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let row = sqlx::query_as!(
        SenderIdRow,
        r#"
        SELECT sender_id AS "sender_id: MacroUserIdStr"
        FROM comms_messages
        WHERE id = $1 AND channel_id = $2
        ORDER BY created_at ASC
        "#,
        message_id,
        channel_id,
    )
    .fetch_optional(pool)
    .await
    .context("unable to get message owner")?;
    Ok(row.map(|row| row.sender_id.to_string()))
}

async fn get_channel_participants_for_thread_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> anyhow::Result<Vec<MacroUserIdStr<'static>>> {
    let rows = sqlx::query_as!(
        MacroUserIdRow,
        r#"
        SELECT DISTINCT id AS "user_id!: MacroUserIdStr" FROM (
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
    Ok(rows.into_iter().map(|row| row.user_id).collect())
}

fn static_channel_name(
    channel_type: ChannelType,
    channel_name: Option<&str>,
    channel_id: Uuid,
) -> String {
    if let Some(name) = channel_name {
        return name.to_string();
    }

    match channel_type {
        ChannelType::Organization => {
            tracing::warn!(channel_id=%channel_id, "organization channel should have a name");
            "Organization".to_string()
        }
        ChannelType::Public => {
            tracing::warn!(channel_id=%channel_id, "public channel should have a name");
            "Public".to_string()
        }
        ChannelType::Team => {
            tracing::warn!(channel_id=%channel_id, "team channel should have a name");
            "Team".to_string()
        }
        ChannelType::Private | ChannelType::DirectMessage => String::new(),
    }
}

async fn resolve_channel_display_name(
    pool: &PgPool,
    info: &ChannelInfo,
    viewer_user_id: MacroUserIdStr<'_>,
) -> anyhow::Result<String> {
    match info.channel_type {
        ChannelType::Organization | ChannelType::Public | ChannelType::Team => Ok(
            static_channel_name(info.channel_type, info.name.as_deref(), info.id),
        ),
        ChannelType::Private
            if info
                .name
                .as_ref()
                .is_some_and(|name| !name.trim().is_empty()) =>
        {
            Ok(info.name.clone().unwrap_or_default())
        }
        ChannelType::Private | ChannelType::DirectMessage => {
            let participant_ids = load_active_participant_ids(pool, info.id).await?;
            let name_lookup = load_user_display_names(pool, &participant_ids).await?;
            if matches!(info.channel_type, ChannelType::DirectMessage)
                && participant_ids
                    .iter()
                    .any(|participant_id| participant_id == viewer_user_id.as_ref())
            {
                if let Some(other_participant_id) = participant_ids
                    .iter()
                    .find(|participant_id| participant_id.as_str() != viewer_user_id.as_ref())
                {
                    return Ok(user_display_name(other_participant_id, &name_lookup));
                }

                tracing::warn!(channel_id=%info.id, "direct message channel has no other participant");
                return Ok("Unknown".to_string());
            }

            Ok(participant_ids
                .iter()
                .map(|participant_id| user_display_name(participant_id, &name_lookup))
                .collect::<Vec<_>>()
                .join(", "))
        }
    }
}

async fn load_active_participant_ids(
    pool: &PgPool,
    channel_id: Uuid,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_as!(
        UserIdRow,
        r#"
        SELECT user_id
        FROM comms_channel_participants
        WHERE channel_id = $1 AND left_at IS NULL
        ORDER BY joined_at ASC, user_id ASC
        "#,
        channel_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|row| row.user_id).collect())
}

async fn load_user_display_names(
    pool: &PgPool,
    user_ids: &[String],
) -> anyhow::Result<HashMap<String, String>> {
    if user_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        UserDisplayNameRow,
        r#"
        SELECT u.id AS user_profile_id, mui.first_name, mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
        user_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut lookup = HashMap::with_capacity(rows.len());
    for row in rows {
        if let Some(name) = display_name(row.first_name.as_deref(), row.last_name.as_deref()) {
            lookup.insert(row.user_profile_id, name);
        }
    }

    Ok(lookup)
}

fn display_name(first_name: Option<&str>, last_name: Option<&str>) -> Option<String> {
    const NA: &str = "N/A";
    match (
        first_name.filter(|value| *value != NA),
        last_name.filter(|value| *value != NA),
    ) {
        (None, None) => None,
        (None, Some(last_name)) => Some(last_name.to_string()),
        (Some(first_name), None) => Some(first_name.to_string()),
        (Some(first_name), Some(last_name)) => Some(format!("{first_name} {last_name}")),
    }
}

fn user_display_name(user_id: &str, name_lookup: &HashMap<String, String>) -> String {
    name_lookup
        .get(user_id)
        .filter(|name| !name.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback_user_name(user_id))
}

fn fallback_user_name(user_id: &str) -> String {
    let email = user_id.split_once('|').map_or(user_id, |(_, email)| email);
    email
        .split_once('@')
        .map_or(email, |(local, _)| local)
        .to_string()
}

impl ChannelRepo for PgChannelsRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_top_level_messages(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
        filters: &ChannelMessageFilters,
        notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> Result<TopLevelMessagesQueryResult, Self::Err> {
        let (cursor_created_at, cursor_id) = match query.vals() {
            (Some(id), Some(val)) => (Some(*val), Some(*id)),
            _ => (None, None),
        };
        let limit_i64 = i64::from(limit);
        let limit_usize = usize::from(limit);

        let message_ids_filter: Option<&[Uuid]> = if filters.message_ids.is_empty() {
            None
        } else {
            Some(&filters.message_ids)
        };
        let created_after = filters.created_after;
        let created_before = filters.created_before;
        let activity_after = filters.activity_after;
        let activity_before = filters.activity_before;
        let notification_filter_active = !filters.notification_filters.is_empty();
        let notification_user_id = match (notification_filter_active, notification_user_id.as_ref())
        {
            (true, Some(user_id)) => user_id.as_ref(),
            (true, None) => {
                anyhow::bail!("notification_user_id is required when notification_filters are set")
            }
            (false, _) => "",
        };
        let notification_done = filters.notification_filters.done;
        let notification_seen = filters.notification_filters.seen;

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
                      AND ($5::uuid[] IS NULL OR m.id = ANY($5))
                      AND ($6::timestamptz IS NULL OR m.created_at >= $6)
                      AND ($7::timestamptz IS NULL OR m.created_at < $7)
                      AND (
                          ($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                          OR (
                              ($8::timestamptz IS NULL OR m.created_at >= $8)
                              AND ($9::timestamptz IS NULL OR m.created_at < $9)
                          )
                          OR EXISTS (
                              SELECT 1 FROM comms_messages r
                              WHERE r.thread_id = m.id
                                AND r.deleted_at IS NULL
                                AND ($8::timestamptz IS NULL OR r.created_at >= $8)
                                AND ($9::timestamptz IS NULL OR r.created_at < $9)
                          )
                      )
                      AND ($10::bool = FALSE OR (
                          ($11::bool IS NULL OR EXISTS (
                              SELECT 1
                              FROM notification n
                              JOIN user_notification un ON un.notification_id = n.id
                              JOIN comms_messages msg ON msg.id = (n.metadata->>'messageId')::uuid
                              WHERE un.user_id = $13::text
                                AND un.deleted_at IS NULL
                                AND un.done = $11
                                AND n.event_item_type = 'channel'
                                AND n.event_item_id = $1::uuid::text
                                AND n.metadata->>'messageId' IS NOT NULL
                                AND msg.channel_id = $1
                                AND msg.deleted_at IS NULL
                                AND COALESCE(msg.thread_id, msg.id) = m.id
                          ))
                          AND ($12::bool IS NULL OR EXISTS (
                              SELECT 1
                              FROM notification n
                              JOIN user_notification un ON un.notification_id = n.id
                              JOIN comms_messages msg ON msg.id = (n.metadata->>'messageId')::uuid
                              WHERE un.user_id = $13::text
                                AND un.deleted_at IS NULL
                                AND (un.seen_at IS NOT NULL) = $12
                                AND n.event_item_type = 'channel'
                                AND n.event_item_id = $1::uuid::text
                                AND n.metadata->>'messageId' IS NOT NULL
                                AND msg.channel_id = $1
                                AND msg.deleted_at IS NULL
                                AND COALESCE(msg.thread_id, msg.id) = m.id
                          ))
                      ))
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT $4
                    "#,
                    channel_id,
                    cursor_created_at,
                    cursor_id,
                    limit_i64,
                    message_ids_filter as Option<&[Uuid]>,
                    created_after,
                    created_before,
                    activity_after,
                    activity_before,
                    notification_filter_active,
                    notification_done,
                    notification_seen,
                    notification_user_id,
                )
                .fetch_all(&self.pool)
                .await?;

                (rows, cursor_created_at.is_some())
            }
            MessagePageDirection::Newer => {
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
                      AND ($5::uuid[] IS NULL OR m.id = ANY($5))
                      AND ($6::timestamptz IS NULL OR m.created_at >= $6)
                      AND ($7::timestamptz IS NULL OR m.created_at < $7)
                      AND (
                          ($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                          OR (
                              ($8::timestamptz IS NULL OR m.created_at >= $8)
                              AND ($9::timestamptz IS NULL OR m.created_at < $9)
                          )
                          OR EXISTS (
                              SELECT 1 FROM comms_messages r
                              WHERE r.thread_id = m.id
                                AND r.deleted_at IS NULL
                                AND ($8::timestamptz IS NULL OR r.created_at >= $8)
                                AND ($9::timestamptz IS NULL OR r.created_at < $9)
                          )
                      )
                      AND ($10::bool = FALSE OR (
                          ($11::bool IS NULL OR EXISTS (
                              SELECT 1
                              FROM notification n
                              JOIN user_notification un ON un.notification_id = n.id
                              JOIN comms_messages msg ON msg.id = (n.metadata->>'messageId')::uuid
                              WHERE un.user_id = $13::text
                                AND un.deleted_at IS NULL
                                AND un.done = $11
                                AND n.event_item_type = 'channel'
                                AND n.event_item_id = $1::uuid::text
                                AND n.metadata->>'messageId' IS NOT NULL
                                AND msg.channel_id = $1
                                AND msg.deleted_at IS NULL
                                AND COALESCE(msg.thread_id, msg.id) = m.id
                          ))
                          AND ($12::bool IS NULL OR EXISTS (
                              SELECT 1
                              FROM notification n
                              JOIN user_notification un ON un.notification_id = n.id
                              JOIN comms_messages msg ON msg.id = (n.metadata->>'messageId')::uuid
                              WHERE un.user_id = $13::text
                                AND un.deleted_at IS NULL
                                AND (un.seen_at IS NOT NULL) = $12
                                AND n.event_item_type = 'channel'
                                AND n.event_item_id = $1::uuid::text
                                AND n.metadata->>'messageId' IS NOT NULL
                                AND msg.channel_id = $1
                                AND msg.deleted_at IS NULL
                                AND COALESCE(msg.thread_id, msg.id) = m.id
                          ))
                      ))
                    ORDER BY m.created_at ASC, m.id ASC
                    LIMIT $4
                    "#,
                    channel_id,
                    cursor_created_at,
                    cursor_id,
                    limit_i64 + 1,
                    message_ids_filter as Option<&[Uuid]>,
                    created_after,
                    created_before,
                    activity_after,
                    activity_before,
                    notification_filter_active,
                    notification_done,
                    notification_seen,
                    notification_user_id,
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
        let rows = sqlx::query_as!(
            ThreadReplyOnlyRow,
            r#"
            SELECT
                id,
                thread_id AS "thread_id!",
                sender_id,
                content,
                created_at,
                updated_at,
                edited_at::timestamptz AS "edited_at?"
            FROM comms_messages
            WHERE thread_id = $1
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            "#,
            parent_id,
        )
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
        attachment_type: Option<ChannelAttachmentType>,
    ) -> Result<Vec<ChannelAttachment>, Self::Err> {
        let (cursor_created_at, cursor_id) = match query.vals() {
            (Some(id), Some(val)) => (Some(*val), Some(*id)),
            _ => (None, None),
        };

        let is_static_filter = attachment_type.map(|t| t == ChannelAttachmentType::Static);

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
              AND ($5::bool IS NULL
                   OR ($5 = true AND a.entity_type LIKE 'static/%')
                   OR ($5 = false AND a.entity_type NOT LIKE 'static/%'))
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $4
            "#,
            channel_id,
            cursor_created_at,
            cursor_id,
            i64::from(limit) as i64,
            is_static_filter,
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
            SELECT
                channel_id,
                user_id,
                role AS "role: ParticipantRole",
                joined_at,
                left_at::timestamptz AS "left_at?"
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
            .map(|row| ChannelParticipant {
                channel_id: row.channel_id,
                user_id: row.user_id,
                role: row.role,
                joined_at: row.joined_at,
                left_at: row.left_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_messages_with_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> Result<Vec<ChannelContextMessage>, Self::Err> {
        let before = before.max(0);
        let after = after.max(0);

        let target = sqlx::query_as!(
            ContextMessageRow,
            r#"
            SELECT
                id,
                channel_id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages
            WHERE id = $1 AND channel_id = $2
            "#,
            message_id,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(target) = target else {
            return Ok(Vec::new());
        };

        let mut before_messages = sqlx::query_as!(
            ContextMessageRow,
            r#"
            SELECT
                id,
                channel_id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages
            WHERE channel_id = $1
              AND (created_at, id) < ($2, $3)
            ORDER BY created_at DESC, id DESC
            LIMIT $4
            "#,
            channel_id,
            target.created_at,
            target.id,
            before,
        )
        .fetch_all(&self.pool)
        .await?;
        before_messages.reverse();

        let after_messages = sqlx::query_as!(
            ContextMessageRow,
            r#"
            SELECT
                id,
                channel_id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            FROM comms_messages
            WHERE channel_id = $1
              AND (created_at, id) > ($2, $3)
            ORDER BY created_at ASC, id ASC
            LIMIT $4
            "#,
            channel_id,
            target.created_at,
            target.id,
            after,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut messages = Vec::with_capacity(before_messages.len() + 1 + after_messages.len());
        messages.extend(before_messages);
        messages.push(target);
        messages.extend(after_messages);

        Ok(messages
            .into_iter()
            .map(ChannelContextMessage::from)
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
    async fn resolve_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<ResolvedChannelMessage>, Self::Err> {
        let row = sqlx::query_as!(
            ResolvedMessageRow,
            r#"
            SELECT id, channel_id, thread_id, created_at
            FROM comms_messages
            WHERE id = $1
              AND channel_id = $2
            "#,
            message_id,
            channel_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| {
            let kind = if r.thread_id.is_some() {
                ChannelMessageKind::ThreadReply
            } else {
                ChannelMessageKind::TopLevelMessage
            };
            ResolvedChannelMessage {
                message_id: r.id,
                channel_id: r.channel_id,
                kind,
                thread_id: r.thread_id.unwrap_or(r.id),
                created_at: r.created_at,
            }
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

    async fn get_channel_info(&self, channel_id: Uuid) -> Result<ChannelInfo, Self::Err> {
        let row = sqlx::query_as!(
            ChannelInfoRow,
            r#"
            SELECT id, name, channel_type AS "channel_type: ChannelType", org_id, team_id
            FROM comms_channels
            WHERE id = $1
            "#,
            channel_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(ChannelInfo {
            id: row.id,
            name: row.name,
            channel_type: row.channel_type,
            org_id: row.org_id,
            team_id: row.team_id,
        })
    }

    async fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<ChannelMetadata, Self::Err> {
        let info = self.get_channel_info(channel_id).await?;
        let channel_name = resolve_channel_display_name(&self.pool, &info, viewer_user_id).await?;
        Ok(ChannelMetadata {
            channel_type: info.channel_type,
            channel_name,
        })
    }

    async fn user_has_team(&self, user_id: String, team_id: Uuid) -> Result<bool, Self::Err> {
        let has_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1 AND team_id = $2
            ) AS "has_team!"
            "#,
            user_id,
            team_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(has_team)
    }

    async fn create_channel(
        &self,
        owner_id: String,
        org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> Result<Uuid, Self::Err> {
        let channel_id = macro_uuid::generate_uuid_v7();
        let mut transaction = self.pool.begin().await?;
        sqlx::query!(
            r#"
            INSERT INTO comms_channels (id, name, owner_id, org_id, team_id, channel_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            channel_id,
            req.name.as_deref(),
            &owner_id,
            org_id,
            req.team_id,
            req.channel_type as ChannelType,
        )
        .execute(&mut *transaction)
        .await
        .context("unable to create channel")?;

        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, role, user_id)
            VALUES ($1, $2, $3)
            "#,
            channel_id,
            ParticipantRole::Owner as ParticipantRole,
            &owner_id,
        )
        .execute(&mut *transaction)
        .await
        .context("unable to create channel participant for owner")?;

        for participant in req
            .participants
            .into_iter()
            .filter(|participant| participant != &owner_id)
        {
            sqlx::query!(
                r#"
                INSERT INTO comms_channel_participants (channel_id, role, user_id)
                VALUES ($1, $2, $3)
                "#,
                channel_id,
                ParticipantRole::Member as ParticipantRole,
                participant,
            )
            .execute(&mut *transaction)
            .await
            .context("unable to create channel participant")?;
        }

        create_activity(&mut *transaction, channel_id, &owner_id)
            .await
            .context("unable to create activity for channel")?;
        transaction
            .commit()
            .await
            .context("unable to commit transaction")?;
        Ok(channel_id)
    }

    async fn maybe_get_dm(
        &self,
        user_id: String,
        recipient_id: String,
    ) -> Result<Option<Uuid>, Self::Err> {
        let row = sqlx::query_as!(
            ChannelIdRow,
            r#"
            SELECT id
            FROM comms_channels
            WHERE channel_type = 'direct_message'::comms_channel_type
              AND EXISTS (
                  SELECT 1
                  FROM comms_channel_participants cp
                  WHERE cp.channel_id = comms_channels.id
                    AND cp.user_id = $1
              )
              AND EXISTS (
                  SELECT 1
                  FROM comms_channel_participants cp
                  WHERE cp.channel_id = comms_channels.id
                    AND cp.user_id = $2
              )
            "#,
            user_id,
            recipient_id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to get direct message channel")?;
        Ok(row.map(|row| row.id))
    }

    async fn maybe_get_private_channel(
        &self,
        participants: Vec<String>,
    ) -> Result<Option<Uuid>, Self::Err> {
        let row = sqlx::query_as!(
            ChannelIdRow,
            r#"
            SELECT id
            FROM comms_channels
            WHERE channel_type = 'private'::comms_channel_type
              AND (
                  (
                      SELECT COUNT(*)
                      FROM comms_channel_participants cp
                      WHERE cp.channel_id = comms_channels.id
                        AND cp.user_id = ANY($1)
                  ) = CARDINALITY($1)
                  AND (
                      SELECT COUNT(*)
                      FROM comms_channel_participants
                      WHERE channel_id = comms_channels.id
                  ) = CARDINALITY($1)
              )
            "#,
            &participants,
        )
        .fetch_optional(&self.pool)
        .await
        .context("unable to get private channel")?;
        Ok(row.map(|row| row.id))
    }

    async fn patch_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
        req: PatchChannelRequest,
    ) -> Result<(), Self::Err> {
        let row = sqlx::query_as!(
            ExistsRow,
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM comms_channel_participants
                WHERE channel_id = $1
                  AND user_id = $2
                  AND role IN (
                      'admin'::comms_participant_role,
                      'owner'::comms_participant_role
                  )
            ) AS "exists!"
            "#,
            channel_id,
            user_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check user authorization")?;

        if !row.exists {
            anyhow::bail!(
                "User is not authorized to perform this action, to patch a channel you must be an admin or owner"
            );
        }

        if let Some(channel_name) = req.channel_name {
            sqlx::query!(
                r#"
                UPDATE comms_channels
                SET name = $1
                WHERE id = $2
                "#,
                channel_name,
                channel_id,
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn delete_channel(&self, channel_id: Uuid, user_id: String) -> Result<(), Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM comms_channels
            WHERE id = $1
              AND EXISTS (
                  SELECT 1
                  FROM comms_channel_participants
                  WHERE channel_id = $1
                    AND user_id = $2
                    AND role = 'owner'::comms_participant_role
              )
            "#,
            channel_id,
            user_id,
        )
        .execute(&self.pool)
        .await
        .context("failed to delete channel")?;

        if result.rows_affected() == 0 {
            anyhow::bail!(
                "channel not deleted, either it didn't exist or the user_id provided was not the owner"
            );
        }
        Ok(())
    }

    async fn add_participant(
        &self,
        channel_id: Uuid,
        user_id: String,
        role: ParticipantRole,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role)
            VALUES ($1, $2, $3)
            "#,
            channel_id,
            user_id,
            role as ParticipantRole,
        )
        .execute(&self.pool)
        .await
        .context("unable to add participant to channel")?;
        Ok(())
    }

    async fn remove_participant(&self, channel_id: Uuid, user_id: String) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM comms_channel_participants
            WHERE channel_id = $1 AND user_id = $2
            "#,
            channel_id,
            user_id,
        )
        .execute(&self.pool)
        .await
        .context("unable to remove participant from channel")?;
        Ok(())
    }

    async fn create_message(
        &self,
        channel_id: Uuid,
        sender_id: String,
        content: String,
        thread_id: Option<Uuid>,
    ) -> Result<MutatedMessage, Self::Err> {
        let message_id = macro_uuid::generate_uuid_v7();
        let row = sqlx::query_as!(
            MutatedMessageRow,
            r#"
            INSERT INTO comms_messages (id, channel_id, sender_id, content, thread_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                channel_id,
                sender_id AS "sender_id: MacroUserIdStr",
                content,
                created_at,
                updated_at,
                thread_id,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            "#,
            message_id,
            channel_id,
            sender_id,
            content,
            thread_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("unable to create message")?;
        Ok(row.into())
    }

    async fn touch_channel_updated_at(&self, channel_id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE comms_channels
            SET updated_at = $2
            WHERE id = $1
            "#,
            channel_id,
            Utc::now(),
        )
        .execute(&self.pool)
        .await
        .context("unable to update the channel updated_at timestamp")?;
        Ok(())
    }

    async fn create_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        insert_message_mentions(&self.pool, message_id, &mentions)
            .await
            .map(|_| ())
    }

    async fn sync_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let source_entity_ids = [message_id.to_string()];
        delete_entity_mentions_by_source(&mut *transaction, &source_entity_ids).await?;
        insert_message_mentions(&mut *transaction, message_id, &mentions).await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn add_attachments(
        &self,
        message_id: Uuid,
        channel_id: Uuid,
        attachments: Vec<NewChannelAttachment>,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        if attachments.is_empty() {
            return Ok(vec![]);
        }

        let mut inserted = Vec::with_capacity(attachments.len());
        for attachment in attachments {
            let row = sqlx::query_as!(
                MutatedAttachmentRow,
                r#"
                INSERT INTO comms_attachments (
                    id,
                    message_id,
                    channel_id,
                    entity_type,
                    entity_id,
                    width,
                    height
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, message_id, channel_id, entity_type, entity_id, width, height, created_at
                "#,
                macro_uuid::generate_uuid_v7(),
                message_id,
                channel_id,
                attachment.entity_type,
                attachment.entity_id,
                attachment.width,
                attachment.height,
            )
            .fetch_one(&self.pool)
            .await?;
            inserted.push(row.into());
        }
        Ok(inserted)
    }

    async fn get_message_attachments(
        &self,
        message_id: Uuid,
    ) -> Result<Vec<MutatedAttachment>, Self::Err> {
        Ok(sqlx::query_as!(
            MutatedAttachmentRow,
            r#"
                SELECT id, message_id, channel_id, entity_type, entity_id, width, height, created_at
                FROM comms_attachments
                WHERE message_id = $1
                "#,
            message_id,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Into::into)
        .collect::<Vec<_>>())
    }

    async fn delete_attachments(&self, attachment_ids: Vec<Uuid>) -> Result<(), Self::Err> {
        if attachment_ids.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            DELETE FROM comms_attachments
            WHERE id = ANY($1)
            "#,
            &attachment_ids,
        )
        .execute(&self.pool)
        .await
        .context("failed to delete attachments by IDs")?;
        Ok(())
    }

    async fn delete_entity_mentions_for_entities(
        &self,
        entity_ids: Vec<String>,
        source_entity_id: String,
    ) -> Result<(), Self::Err> {
        if entity_ids.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            DELETE FROM comms_entity_mentions
            WHERE entity_id = ANY($1) AND source_entity_id = $2
            "#,
            &entity_ids,
            source_entity_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn patch_message_attachments(
        &self,
        message_id: Uuid,
        attachments: Vec<MutatedAttachment>,
    ) -> Result<MutatedMessage, Self::Err> {
        let has_attachments = !attachments.is_empty();
        let row = sqlx::query_as!(
            MutatedMessageRow,
            r#"
            UPDATE comms_messages
            SET
                updated_at = NOW(),
                edited_at = NOW(),
                deleted_at = CASE
                    WHEN $2 = false AND (content IS NULL OR content ~ '^[\s]*$') THEN NOW()
                    ELSE deleted_at
                END
            WHERE id = $1
            RETURNING
                id,
                channel_id,
                sender_id AS "sender_id: MacroUserIdStr",
                content,
                created_at,
                updated_at,
                thread_id,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            "#,
            message_id,
            has_attachments,
        )
        .fetch_one(&self.pool)
        .await
        .context("unable to update message")?;
        Ok(row.into())
    }

    async fn patch_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        content: String,
    ) -> Result<MutatedMessage, Self::Err> {
        let row = sqlx::query_as!(
            MutatedMessageRow,
            r#"
            UPDATE comms_messages
            SET content = $1, updated_at = NOW(), edited_at = NOW()
            WHERE id = $2 AND channel_id = $3
            RETURNING
                id,
                channel_id,
                sender_id AS "sender_id: MacroUserIdStr",
                content,
                created_at,
                updated_at,
                thread_id,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            "#,
            content,
            message_id,
            channel_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("unable to update message")?;
        Ok(row.into())
    }
    async fn delete_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<MutatedMessage, Self::Err> {
        let row = sqlx::query_as!(
            MutatedMessageRow,
            r#"
            UPDATE comms_messages
            SET content = '', updated_at = NOW(), deleted_at = NOW()
            WHERE id = $1 AND channel_id = $2
            RETURNING
                id,
                channel_id,
                sender_id AS "sender_id: MacroUserIdStr",
                content,
                created_at,
                updated_at,
                thread_id,
                edited_at::timestamptz AS "edited_at?",
                deleted_at::timestamptz AS "deleted_at?"
            "#,
            message_id,
            channel_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("unable to delete message")?;
        Ok(row.into())
    }

    async fn get_message_owner(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<String>, Self::Err> {
        get_message_owner(&self.pool, channel_id, message_id).await
    }

    async fn get_participants(
        &self,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelParticipant>, Self::Err> {
        let rows = sqlx::query_as!(
            ParticipantRow,
            r#"
            SELECT
                user_id,
                channel_id,
                joined_at,
                left_at::timestamptz AS "left_at?",
                role AS "role: ParticipantRole"
            FROM comms_channel_participants
            WHERE channel_id = $1
            ORDER BY joined_at DESC
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ChannelParticipant {
                channel_id: row.channel_id,
                user_id: row.user_id,
                role: row.role,
                joined_at: row.joined_at,
                left_at: row.left_at,
            })
            .collect())
    }

    async fn get_thread_participants(
        &self,
        thread_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        get_channel_participants_for_thread_id(&self.pool, thread_id).await
    }

    async fn upsert_activity(&self, user_id: String, channel_id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO comms_activity (id, user_id, channel_id, interacted_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id, channel_id) DO UPDATE
            SET interacted_at = NOW(), updated_at = NOW()
            "#,
            macro_uuid::generate_uuid_v7(),
            user_id,
            channel_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn add_reaction(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> Result<(), Self::Err> {
        let row = sqlx::query_as!(
            ExistsRow,
            r#"
            WITH message AS (
                SELECT id
                FROM comms_messages
                WHERE id = $2 AND channel_id = $1
            ),
            inserted AS (
                INSERT INTO comms_reactions (message_id, emoji, user_id)
                SELECT id, $3, $4
                FROM message
                ON CONFLICT DO NOTHING
            )
            SELECT EXISTS (SELECT 1 FROM message) AS "exists!"
            "#,
            channel_id,
            message_id,
            emoji,
            user_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to add reaction")?;
        if !row.exists {
            anyhow::bail!("message not found in channel");
        }
        Ok(())
    }

    async fn remove_reaction(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> Result<(), Self::Err> {
        let row = sqlx::query_as!(
            ExistsRow,
            r#"
            WITH message AS (
                SELECT id
                FROM comms_messages
                WHERE id = $2 AND channel_id = $1
            ),
            deleted AS (
                DELETE FROM comms_reactions r
                USING message m
                WHERE r.message_id = m.id
                  AND r.emoji = $3
                  AND r.user_id = $4
            )
            SELECT EXISTS (SELECT 1 FROM message) AS "exists!"
            "#,
            channel_id,
            message_id,
            emoji,
            user_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to remove reaction")?;
        if !row.exists {
            anyhow::bail!("message not found in channel");
        }
        Ok(())
    }

    async fn get_message_reactions(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<CountedReaction>, Self::Err> {
        let reactions = sqlx::query_as!(
            ReactionWithCreatedAtRow,
            r#"
            SELECT r.emoji, r.user_id, r.created_at
            FROM comms_reactions r
            JOIN comms_messages m ON m.id = r.message_id
            WHERE r.message_id = $1 AND m.channel_id = $2
            "#,
            message_id,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("unable to fetch reactions")?
        .into_iter()
        .map(|row| (row.emoji, row.user_id, row.created_at))
        .collect::<Vec<_>>();
        Ok(group_counted_reactions(reactions))
    }
}
