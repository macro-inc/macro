#[cfg(test)]
mod tests;

#[cfg(feature = "attachment")]
use crate::domain::ports::ChannelAttachmentRepo;
#[cfg(feature = "list")]
use crate::domain::ports::{ChannelListRepo, ChannelListUserRepo};
use crate::domain::{
    models::{
        Activity, ActivityType, AttachmentChannelReference, AttachmentEntityReference,
        AttachmentGenericReference, BotId, BotSenderProfile, ChannelAttachment,
        ChannelAttachmentType, ChannelContextMessage, ChannelInfo, ChannelListItem,
        ChannelMessageFilters, ChannelMessageKind, ChannelMetadata, ChannelParticipant,
        ChannelPreviewRow, ChannelThreadReplyRows, ChannelType, ChannelWithParticipants,
        CountedReaction, CreateChannelRequest, CreateEntityMentionOptions, EntityMention,
        GetChannelsParams, GetThreadReplyRowsParams, LatestMessage, MessageAttachment,
        MessagePageDirection, MutatedAttachment, MutatedMessage, NameLookup, NewChannelAttachment,
        ParticipantRole, PatchChannelRequest, RecentChannelMessage, ResolvedChannelMessage, Sender,
        SimpleMention, ThreadData, ThreadReplyRow, TopLevelMessageRow, UserName,
        fallback_user_name,
    },
    ports::{ChannelRepo, TopLevelMessagesQueryResult},
};
use anyhow::Context;
use chrono::{DateTime, Utc};
#[cfg(feature = "list")]
use filter_ast::Expr;
#[cfg(feature = "list")]
use item_filters::ast::{
    LiteralTree,
    channel::{ChannelLiteral, ChannelThreadLiteral},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{CreatedAt, Query};
#[cfg(feature = "list")]
use recursion::CollapsibleExt;
use sqlx::{Executor, PgPool, Postgres};
#[cfg(feature = "list")]
use sqlx::{QueryBuilder, Row, postgres::PgRow};
use std::collections::{HashMap, HashSet};
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
            // Bot profiles are joined in the service layer.
            bot_profile: None,
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
    sender_id: String,
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

/// Intermediate row for batch channel preview lookups.
#[derive(Debug, sqlx::FromRow)]
struct ChannelPreviewQueryRow {
    id: Uuid,
    name: Option<String>,
    channel_type: ChannelType,
    org_id: Option<i64>,
    team_id: Option<Uuid>,
    has_access: bool,
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
    user_id: String,
}

#[derive(Debug, sqlx::FromRow)]
struct SenderIdRow {
    sender_id: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ChannelIdRow {
    id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
struct ExistsRow {
    exists: bool,
}

fn mutated_message_from_row(row: MutatedMessageRow) -> anyhow::Result<MutatedMessage> {
    let sender_id = Sender::parse_storage_str(&row.sender_id)
        .with_context(|| format!("invalid message sender_id {}", row.sender_id))?;
    Ok(MutatedMessage {
        id: row.id,
        channel_id: row.channel_id,
        thread_id: row.thread_id,
        sender_id,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
        edited_at: row.edited_at,
        deleted_at: row.deleted_at,
    })
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
        SELECT sender_id
        FROM comms_messages
        WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL
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
        SELECT DISTINCT id AS "user_id!" FROM (
            SELECT m.sender_id AS id
            FROM comms_messages m
            JOIN comms_channel_participants cp
              ON cp.channel_id = m.channel_id AND cp.user_id = m.sender_id
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

fn static_channel_name(
    channel_type: ChannelType,
    channel_name: Option<&str>,
    channel_id: Uuid,
) -> String {
    if let Some(name) = channel_name {
        return name.to_string();
    }

    match channel_type {
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
        ChannelType::Public | ChannelType::Team => Ok(static_channel_name(
            info.channel_type,
            info.name.as_deref(),
            info.id,
        )),
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
                    .any(|participant_id| participant_id.as_ref() == viewer_user_id.as_ref())
            {
                if let Some(other_participant_id) = participant_ids
                    .iter()
                    .find(|participant_id| participant_id.as_ref() != viewer_user_id.as_ref())
                {
                    return Ok(id_to_display_name(other_participant_id, &name_lookup));
                }

                tracing::warn!(channel_id=%info.id, "direct message channel has no other participant");
                return Ok("Unknown".to_string());
            }

            Ok(participant_ids
                .iter()
                .map(|participant_id| id_to_display_name(participant_id, &name_lookup))
                .collect::<Vec<_>>()
                .join(", "))
        }
    }
}

async fn load_active_participant_ids(
    pool: &PgPool,
    channel_id: Uuid,
) -> anyhow::Result<Vec<MacroUserIdStr<'static>>> {
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
    rows.into_iter()
        .map(|row| MacroUserIdStr::try_from(row.user_id).map_err(Into::into))
        .collect()
}

async fn load_user_display_names(
    pool: &PgPool,
    user_ids: &[MacroUserIdStr<'static>],
) -> anyhow::Result<NameLookup> {
    if user_ids.is_empty() {
        return Ok(NameLookup::new());
    }

    let user_id_strings: Vec<String> = user_ids
        .iter()
        .map(|user_id| user_id.as_ref().to_string())
        .collect();
    let user_ids_by_string: HashMap<_, _> = user_ids
        .iter()
        .map(|user_id| (user_id.as_ref().to_string(), user_id.clone()))
        .collect();

    let rows = sqlx::query_as!(
        UserDisplayNameRow,
        r#"
        SELECT u.id AS user_profile_id, mui.first_name, mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
        &user_id_strings,
    )
    .fetch_all(pool)
    .await?;

    let mut lookup = NameLookup::with_capacity(rows.len());
    for row in rows {
        let Some(name) = display_name(row.first_name.as_deref(), row.last_name.as_deref()) else {
            continue;
        };
        let Some(user_id) = user_ids_by_string.get(&row.user_profile_id) else {
            continue;
        };
        lookup.insert(user_id.clone(), name);
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

fn id_to_display_name(user_id: &MacroUserIdStr<'static>, name_lookup: &NameLookup) -> String {
    match name_lookup.get(user_id) {
        Some(name) if !name.trim().is_empty() => name.clone(),
        _ => fallback_user_name(user_id),
    }
}

#[cfg(feature = "list")]
static CHANNEL_LIST_PREFIX: &str = r#"
    WITH user_channels AS (
        SELECT DISTINCT c.*
        FROM comms_channels c
        INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
"#;

#[cfg(feature = "list")]
static CHANNEL_LIST_SELECT: &str = r#"
    ),
    channel_participants_json AS (
        SELECT
            uc.id as channel_id,
            ARRAY_AGG(
                json_build_object(
                    'channel_id', cp.channel_id,
                    'user_id', cp.user_id,
                    'role', cp.role,
                    'joined_at', cp.joined_at,
                    'left_at', cp.left_at
                )
            ) as participants
        FROM user_channels uc
        JOIN comms_channel_participants cp ON cp.channel_id = uc.id
        WHERE cp.left_at IS NULL
        GROUP BY uc.id
    )
    SELECT
        uc.id as "id",
        uc.name as "name",
        uc.channel_type as "channel_type",
        uc.org_id as "org_id",
        uc.team_id as "team_id",
        uc.created_at as "created_at",
        uc.updated_at as "updated_at",
        uc.owner_id as "owner_id",
        cpj.participants as "participants_json"
    FROM user_channels uc
    LEFT JOIN channel_participants_json cpj ON cpj.channel_id = uc.id
    WHERE
        ($4::timestamptz IS NULL)
        OR
        ((CASE $2 WHEN 'created_at' THEN uc.created_at ELSE uc.updated_at END), uc.id::text) < ($4, $5)
    ORDER BY (CASE $2 WHEN 'created_at' THEN uc.created_at ELSE uc.updated_at END) DESC, uc.id::text DESC
    LIMIT $3
"#;

#[cfg(feature = "list")]
fn build_channel_notification_exists_clause(
    entity_id_sql: &str,
    entity_type: &str,
    predicate_sql: &str,
) -> String {
    format!(
        r#"EXISTS (
            SELECT 1
            FROM notification n
            JOIN user_notification un ON un.notification_id = n.id
            WHERE un.user_id = $1
              AND un.deleted_at IS NULL
              AND n.event_item_type = '{entity_type}'
              AND n.event_item_id = ({entity_id_sql})::text
              AND {predicate_sql}
        )"#
    )
}

#[cfg(feature = "list")]
fn build_channel_list_filter(ast: Option<&Expr<ChannelLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting = expr.collapse_frames(|frame: filter_ast::ExprFrame<String, _>| match frame {
        filter_ast::ExprFrame::And(a, b) => match (a.is_empty(), b.is_empty()) {
            (true, true) => String::new(),
            (true, false) => b,
            (false, true) => a,
            (false, false) => format!("({a} AND {b})"),
        },
        filter_ast::ExprFrame::Or(a, b) => match (a.is_empty(), b.is_empty()) {
            (true, true) => String::new(),
            (true, false) => b,
            (false, true) => a,
            (false, false) => format!("({a} OR {b})"),
        },
        filter_ast::ExprFrame::Not(a) => {
            if a.is_empty() {
                String::new()
            } else {
                format!("(NOT {a})")
            }
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::ChannelId(id)) => format!("c.id = '{id}'"),
        filter_ast::ExprFrame::Literal(ChannelLiteral::OrganizationId(org_id)) => {
            format!("c.org_id = {org_id}")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::TeamId(team_id)) => {
            format!("c.team_id = '{team_id}'")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::ChannelType(ct)) => {
            format!("c.channel_type = '{ct}'")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::ThreadId(_))
        | filter_ast::ExprFrame::Literal(ChannelLiteral::Mention(_))
        | filter_ast::ExprFrame::Literal(ChannelLiteral::Sender(_))
        | filter_ast::ExprFrame::Literal(ChannelLiteral::Importance(true)) => String::new(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::Importance(false)) => "1=0".to_string(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::NotificationDone(done)) => {
            build_channel_notification_exists_clause(
                "c.id",
                "channel",
                if done {
                    "un.done = true"
                } else {
                    "un.done = false"
                },
            )
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::NotificationSeen(seen)) => {
            build_channel_notification_exists_clause(
                "c.id",
                "channel",
                if seen {
                    "un.seen_at IS NOT NULL"
                } else {
                    "un.seen_at IS NULL"
                },
            )
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {formatting}")
    }
}

#[cfg(feature = "list")]
fn build_channel_list_query(
    filter_ast: &LiteralTree<ChannelLiteral>,
) -> QueryBuilder<'_, Postgres> {
    let mut builder = QueryBuilder::new(CHANNEL_LIST_PREFIX);
    builder.push(build_channel_list_filter(filter_ast.as_deref()));
    builder.push(CHANNEL_LIST_SELECT);
    builder
}

#[cfg(feature = "list")]
fn push_channel_thread_sort_expr(
    builder: &mut QueryBuilder<'static, Postgres>,
    sort_method_str: String,
) {
    builder.push("(CASE ");
    builder.push_bind(sort_method_str);
    builder.push(
        " WHEN 'created_at' THEN m.created_at ELSE GREATEST(m.updated_at, COALESCE(thread_stats.latest_reply_updated_at, m.updated_at)) END)",
    );
}

#[cfg(feature = "list")]
fn push_channel_thread_filter_expr(
    builder: &mut QueryBuilder<'static, Postgres>,
    expr: &Expr<ChannelThreadLiteral>,
) {
    match expr {
        Expr::And(a, b) => {
            builder.push("(");
            push_channel_thread_filter_expr(builder, a);
            builder.push(" AND ");
            push_channel_thread_filter_expr(builder, b);
            builder.push(")");
        }
        Expr::Or(a, b) => {
            builder.push("(");
            push_channel_thread_filter_expr(builder, a);
            builder.push(" OR ");
            push_channel_thread_filter_expr(builder, b);
            builder.push(")");
        }
        Expr::Not(a) => {
            builder.push("(NOT ");
            push_channel_thread_filter_expr(builder, a);
            builder.push(")");
        }
        Expr::Literal(ChannelThreadLiteral::ThreadId(id)) => {
            builder.push("m.id = ");
            builder.push_bind(*id);
        }
        Expr::Literal(ChannelThreadLiteral::ChannelId(channel_id)) => {
            builder.push("c.id = ");
            builder.push_bind(*channel_id);
        }
        Expr::Literal(ChannelThreadLiteral::RootSender(sender)) => {
            builder.push("m.sender_id = ");
            builder.push_bind(sender.as_ref().to_string());
        }
    }
}

#[cfg(feature = "list")]
fn build_channel_thread_rows_query(
    params: &GetThreadReplyRowsParams,
) -> QueryBuilder<'static, Postgres> {
    // Dynamic QueryBuilder is required because the channel-thread filter is an AST with
    // arbitrary AND/OR/NOT shape. All runtime values are still passed as bind parameters.
    let cursor = params.query();
    let sort_method_str = cursor.sort_method().to_string();
    let query_limit = params.limit().map(i64::from);
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id_str = cursor_id.map(|id| id.to_string());
    let cursor_timestamp = cursor_timestamp.cloned();

    let mut builder = QueryBuilder::new(
        r#"
        WITH user_channels AS (
            SELECT DISTINCT c.*
            FROM comms_channels c
            INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = "#,
    );
    builder.push_bind(params.user().as_ref().to_string());
    builder.push(
        r#" AND cp.left_at IS NULL
        )
        SELECT
            m.id AS id,
            m.channel_id AS channel_id,
            m.sender_id AS sender_id,
            m.content AS content,
            m.created_at AS created_at,
            m.updated_at AS updated_at,
            m.edited_at::timestamptz AS edited_at,
            m.deleted_at::timestamptz AS deleted_at
        FROM comms_messages m
        INNER JOIN user_channels c ON c.id = m.channel_id
        LEFT JOIN LATERAL (
            SELECT MAX(reply.updated_at) AS latest_reply_updated_at
            FROM comms_messages reply
            WHERE reply.thread_id = m.id
              AND reply.deleted_at IS NULL
        ) thread_stats ON TRUE
        WHERE m.thread_id IS NULL
          AND m.deleted_at IS NULL
        "#,
    );

    if let Some(expr) = cursor.filter().as_deref() {
        builder.push(" AND ");
        push_channel_thread_filter_expr(&mut builder, expr);
    }

    builder.push(" AND (");
    builder.push_bind(cursor_timestamp);
    builder.push("::timestamptz IS NULL OR (");
    push_channel_thread_sort_expr(&mut builder, sort_method_str.clone());
    builder.push(", m.id::text) < (");
    builder.push_bind(cursor_timestamp);
    builder.push(", ");
    builder.push_bind(cursor_id_str);
    builder.push(")) ORDER BY ");
    push_channel_thread_sort_expr(&mut builder, sort_method_str);
    builder.push(" DESC, m.id::text DESC LIMIT ");
    builder.push_bind(query_limit);

    builder
}

#[cfg(feature = "list")]
struct ChannelListRow {
    id: Uuid,
    name: Option<String>,
    channel_type: ChannelType,
    org_id: Option<i64>,
    team_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    owner_id: String,
    participants_json: Option<Vec<serde_json::Value>>,
}

#[cfg(feature = "list")]
impl ChannelListRow {
    fn into_channel_with_participants(self) -> Result<ChannelWithParticipants, sqlx::Error> {
        let channel = ChannelListItem {
            id: self.id,
            name: self.name,
            channel_type: self.channel_type,
            org_id: self.org_id,
            team_id: self.team_id,
            created_at: self.created_at,
            updated_at: self.updated_at,
            owner_id: MacroUserIdStr::parse_from_str(&self.owner_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
        };

        let participants = self
            .participants_json
            .map(|json_array| {
                json_array
                    .iter()
                    .filter_map(|json_value| {
                        serde_json::from_value::<ChannelParticipant>(json_value.clone()).ok()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(ChannelWithParticipants {
            channel,
            participants,
        })
    }
}

#[cfg(feature = "list")]
impl ChannelListRepo for PgChannelsRepo {
    async fn get_user_channels_with_participants(
        &self,
        params: GetChannelsParams,
    ) -> Result<Vec<ChannelWithParticipants>, rootcause::Report> {
        let user_id = params.user();
        let query_limit = params.limit().map(i64::from);
        let cursor = params.query();
        let sort_method_str = cursor.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = cursor.vals();
        let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());

        Ok(build_channel_list_query(cursor.filter())
            .build()
            .bind(user_id.as_ref())
            .bind(sort_method_str)
            .bind(query_limit)
            .bind(cursor_timestamp)
            .bind(cursor_id_str)
            .try_map(|row: PgRow| {
                ChannelListRow {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    channel_type: row.try_get("channel_type")?,
                    org_id: row.try_get("org_id")?,
                    team_id: row.try_get("team_id")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                    owner_id: row.try_get("owner_id")?,
                    participants_json: row.try_get("participants_json")?,
                }
                .into_channel_with_participants()
            })
            .fetch_all(&self.pool)
            .await?)
    }

    async fn get_latest_channel_messages_batch(
        &self,
        channel_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, LatestMessage>, rootcause::Report> {
        if channel_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = sqlx::query!(
            r#"
        WITH input_ids AS (
            SELECT UNNEST($1::uuid[]) AS channel_id
        )
        SELECT
            i.channel_id                                          AS "channel_id!",
            l.message_id                                           AS "l_message_id?: uuid::Uuid",
            l.thread_id                                            AS "l_thread_id?: uuid::Uuid",
            l.sender_id                                            AS "l_sender_id?: String",
            l.content                                              AS "l_content?: String",
            l.created_at                                           AS "l_created_at?: chrono::DateTime<chrono::Utc>",
            l.updated_at                                           AS "l_updated_at?: chrono::DateTime<chrono::Utc>",
            l.deleted_at                                           AS "l_deleted_at?: chrono::DateTime<chrono::Utc>",
            l.mentions                                             AS "l_mentions?: Vec<String>",
            n.message_id                                           AS "n_message_id?: uuid::Uuid",
            n.thread_id                                            AS "n_thread_id?: uuid::Uuid",
            n.sender_id                                            AS "n_sender_id?: String",
            n.content                                              AS "n_content?: String",
            n.created_at                                           AS "n_created_at?: chrono::DateTime<chrono::Utc>",
            n.updated_at                                           AS "n_updated_at?: chrono::DateTime<chrono::Utc>",
            n.deleted_at                                           AS "n_deleted_at?: chrono::DateTime<chrono::Utc>",
            n.mentions                                             AS "n_mentions?: Vec<String>"
        FROM input_ids i
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) l ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
              AND m.thread_id IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) n ON TRUE
        "#,
            channel_ids
        )
        .fetch_all(&self.pool)
        .await?;

        let build_message = |message_id: Option<Uuid>,
                             thread_id: Option<Uuid>,
                             sender_id: Option<String>,
                             content: Option<String>,
                             created_at: Option<DateTime<Utc>>,
                             updated_at: Option<DateTime<Utc>>,
                             deleted_at: Option<DateTime<Utc>>,
                             mentions: Option<Vec<String>>| {
            match (message_id, sender_id, content, created_at, updated_at) {
                (
                    Some(message_id),
                    Some(sender_id),
                    Some(content),
                    Some(created_at),
                    Some(updated_at),
                ) => Some(RecentChannelMessage {
                    message_id,
                    thread_id,
                    sender_id,
                    content,
                    created_at,
                    updated_at,
                    deleted_at,
                    mentions: mentions.unwrap_or_default(),
                }),
                (None, _, _, _, _) => None,
                _ => {
                    tracing::warn!("incomplete latest message row; skipping");
                    None
                }
            }
        };

        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    row.channel_id,
                    LatestMessage {
                        latest_message: build_message(
                            row.l_message_id,
                            row.l_thread_id,
                            row.l_sender_id,
                            row.l_content,
                            row.l_created_at,
                            row.l_updated_at,
                            row.l_deleted_at,
                            row.l_mentions,
                        ),
                        latest_non_thread_message: build_message(
                            row.n_message_id,
                            row.n_thread_id,
                            row.n_sender_id,
                            row.n_content,
                            row.n_created_at,
                            row.n_updated_at,
                            row.n_deleted_at,
                            row.n_mentions,
                        ),
                    },
                )
            })
            .collect())
    }

    async fn get_channel_list_activities(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<Activity>, rootcause::Report> {
        Ok(sqlx::query!(
            r#"
        SELECT
            a.id as "id!: Uuid",
            a.user_id as "user_id!: String",
            a.channel_id as "channel_id!: Uuid",
            a.viewed_at as "viewed_at?: DateTime<Utc>",
            a.interacted_at as "interacted_at?: DateTime<Utc>",
            a.created_at as "created_at!: DateTime<Utc>",
            a.updated_at as "updated_at!: DateTime<Utc>"
        FROM comms_activity a
        WHERE a.user_id = $1
        ORDER BY
            GREATEST(
                COALESCE(a.viewed_at, '1970-01-01'::timestamp),
                COALESCE(a.interacted_at, '1970-01-01'::timestamp)
            ) DESC,
            a.created_at DESC
        LIMIT 100
        "#,
            user_id.as_ref()
        )
        .map(|row| Activity {
            id: row.id,
            user_id: row.user_id,
            channel_id: row.channel_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            viewed_at: row.viewed_at,
            interacted_at: row.interacted_at,
        })
        .fetch_all(&self.pool)
        .await?)
    }

    async fn get_thread_reply_rows(
        &self,
        params: GetThreadReplyRowsParams,
    ) -> Result<Vec<ChannelThreadReplyRows>, rootcause::Report> {
        let parents: Vec<TopLevelMessageRow> = build_channel_thread_rows_query(&params)
            .build()
            .try_map(|row: PgRow| {
                Ok(TopLevelMessageRow {
                    id: row.try_get("id")?,
                    channel_id: row.try_get("channel_id")?,
                    sender_id: row.try_get("sender_id")?,
                    content: row.try_get("content")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                    edited_at: row.try_get("edited_at")?,
                    deleted_at: row.try_get("deleted_at")?,
                })
            })
            .fetch_all(&self.pool)
            .await?;

        let parent_ids: Vec<Uuid> = parents.iter().map(|parent| parent.id).collect();
        if parent_ids.is_empty() {
            return Ok(Vec::new());
        }

        // QueryBuilder keeps this batch fetch independent from SQLx's offline macro cache;
        // all parent ids are still passed as a single bind parameter.
        let mut reply_query = QueryBuilder::new(
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
            WHERE thread_id = ANY("#,
        );
        reply_query.push_bind(parent_ids.clone());
        reply_query.push(
            r#")
              AND deleted_at IS NULL
            ORDER BY thread_id ASC, created_at ASC, id ASC
            "#,
        );
        let reply_rows = reply_query
            .build_query_as::<ThreadReplyOnlyRow>()
            .fetch_all(&self.pool)
            .await?;

        let mut replies_by_parent: HashMap<Uuid, Vec<ThreadReplyRow>> = HashMap::new();
        for row in reply_rows {
            replies_by_parent
                .entry(row.thread_id)
                .or_default()
                .push(ThreadReplyRow {
                    id: row.id,
                    thread_id: row.thread_id,
                    sender_id: row.sender_id,
                    content: row.content,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    edited_at: row.edited_at,
                });
        }

        Ok(parents
            .into_iter()
            .map(|parent| {
                let replies = replies_by_parent.remove(&parent.id).unwrap_or_default();
                ChannelThreadReplyRows { parent, replies }
            })
            .collect())
    }
}

#[cfg(feature = "list")]
impl ChannelListUserRepo for PgChannelsRepo {
    async fn get_names_for_ids(
        &self,
        ids: HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<UserName>, rootcause::Report> {
        let ids = ids.into_iter().map(|s| s.to_string()).collect::<Vec<_>>();
        Ok(sqlx::query!(
            r#"
        SELECT
            u.id as user_profile_id,
            mui.first_name,
            mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
            &ids
        )
        .try_map(|row| {
            Ok(UserName {
                id: MacroUserIdStr::parse_from_str(&row.user_profile_id)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                    .into_owned(),
                first_name: row.first_name,
                last_name: row.last_name,
            })
        })
        .fetch_all(&self.pool)
        .await?)
    }
}

#[cfg(feature = "attachment")]
impl ChannelAttachmentRepo for PgChannelsRepo {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn get_channel_name_for_attachment(
        &self,
        channel_id: Uuid,
    ) -> Result<Option<String>, Self::Err> {
        sqlx::query_scalar!("SELECT name FROM comms_channels WHERE id = $1", channel_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.flatten())
            .map_err(Into::into)
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_recent_messages_for_attachment(
        &self,
        channel_id: Uuid,
        limit: u32,
    ) -> Result<Vec<RecentChannelMessage>, Self::Err> {
        Ok(sqlx::query!(
            r#"
        SELECT
            m.id AS "message_id!",
            m.thread_id,
            m.sender_id AS "sender_id!",
            m.content AS "content!",
            m.created_at AS "created_at!",
            m.updated_at AS "updated_at!",
            m.deleted_at::timestamptz AS "deleted_at?",
            COALESCE(
                ARRAY(
                    SELECT entity_type || ':' || entity_id
                    FROM comms_entity_mentions em
                    WHERE em.source_entity_type = 'message'
                      AND em.source_entity_id = m.id::text
                ),
                '{}'::text[]
            ) AS "mentions!"
        FROM comms_messages m
        WHERE m.channel_id = $1
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT $2
        "#,
            channel_id,
            i64::from(limit)
        )
        .map(|row| RecentChannelMessage {
            message_id: row.message_id,
            thread_id: row.thread_id,
            sender_id: row.sender_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            mentions: row.mentions,
        })
        .fetch_all(&self.pool)
        .await?)
    }
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
            .filter_map(|row| {
                let user_id = MacroUserIdStr::try_from(row.user_id).ok()?;
                Some(ChannelParticipant {
                    channel_id: row.channel_id,
                    user_id: user_id.as_ref().to_string(),
                    role: row.role,
                    joined_at: row.joined_at,
                    left_at: row.left_at,
                })
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

    #[tracing::instrument(err, skip(self, user_id))]
    async fn get_attachment_references(
        &self,
        entity_type: &str,
        entity_id: &str,
        user_id: &str,
    ) -> Result<Vec<AttachmentEntityReference>, Self::Err> {
        let attachment_references_fut = async {
            sqlx::query_as!(
                AttachmentChannelReference,
                r#"
                SELECT
                    a.channel_id                     AS "channel_id: uuid::Uuid",
                    c.name                           AS "channel_name?",            -- Option<String>
                    a.message_id                     AS "message_id: uuid::Uuid",
                    m.thread_id                      AS "thread_id?: uuid::Uuid",
                    m.sender_id                      AS "sender_id!",               -- String
                    m.content                        AS "message_content!",         -- String
                    m.created_at                     AS "message_created_at!: chrono::DateTime<chrono::Utc>",
                    a.created_at                     AS "attachment_created_at!: chrono::DateTime<chrono::Utc>"
                FROM comms_attachments a
                JOIN comms_messages m ON a.message_id = m.id
                JOIN comms_channels c ON a.channel_id = c.id
                JOIN comms_channel_participants cp ON cp.channel_id = c.id
                WHERE a.entity_type = $1
                  AND a.entity_id  = $2
                  AND cp.user_id   = $3
                  AND cp.left_at  IS NULL
                  AND m.deleted_at IS NULL
                ORDER BY a.created_at DESC
                "#,
                entity_type,
                entity_id,
                user_id,
            )
            .fetch_all(&self.pool)
            .await
            .context("failed to get attachment references")
        };

        let mention_references_fut = async {
            sqlx::query_as!(
                AttachmentChannelReference,
                r#"
                SELECT
                    m.channel_id                     AS "channel_id: uuid::Uuid",
                    c.name                           AS "channel_name?",            -- Option<String>
                    m.id                             AS "message_id: uuid::Uuid",
                    m.thread_id                      AS "thread_id?: uuid::Uuid",
                    m.sender_id                      AS "sender_id!",               -- String
                    m.content                        AS "message_content!",         -- String
                    m.created_at                     AS "message_created_at!: chrono::DateTime<chrono::Utc>",
                    em.created_at                    AS "attachment_created_at!: chrono::DateTime<chrono::Utc>"
                FROM comms_entity_mentions em
                JOIN comms_messages m ON (em.source_entity_id = m.id::text AND em.source_entity_type = 'message')
                JOIN comms_channels c ON m.channel_id = c.id
                JOIN comms_channel_participants cp ON cp.channel_id = c.id
                WHERE em.entity_type = $1
                  AND em.entity_id  = $2
                  AND cp.user_id   = $3
                  AND cp.left_at  IS NULL
                  AND m.deleted_at IS NULL
                ORDER BY em.created_at DESC
                "#,
                entity_type,
                entity_id,
                user_id,
            )
            .fetch_all(&self.pool)
            .await
            .context("failed to get mention references")
        };

        let generic_references_fut = async {
            sqlx::query!(
                r#"
                SELECT
                    em.source_entity_type,
                    em.source_entity_id,
                    em.entity_type,
                    em.entity_id,
                    em.user_id,
                    em.created_at
                FROM comms_entity_mentions em
                WHERE em.entity_type = $1
                  AND em.entity_id  = $2
                  AND em.source_entity_type != 'message'
                ORDER BY em.created_at DESC
                "#,
                entity_type,
                entity_id,
            )
            .fetch_all(&self.pool)
            .await
            .context("failed to get generic entity references")
        };

        let (attachment_references, mention_references, generic_rows) = tokio::try_join!(
            attachment_references_fut,
            mention_references_fut,
            generic_references_fut,
        )?;

        let generic_references = generic_rows
            .into_iter()
            .map(|row| AttachmentGenericReference {
                source_entity_type: row.source_entity_type,
                source_entity_id: row.source_entity_id,
                entity_type: row.entity_type,
                entity_id: row.entity_id,
                user_id: row.user_id,
                created_at: row.created_at,
            })
            .collect::<Vec<_>>();

        let mut references: Vec<AttachmentEntityReference> = attachment_references
            .into_iter()
            .map(AttachmentEntityReference::Channel)
            .collect();
        references.extend(
            mention_references
                .into_iter()
                .map(AttachmentEntityReference::Channel),
        );
        references.extend(
            generic_references
                .into_iter()
                .map(AttachmentEntityReference::Generic),
        );

        references.sort_by(|a, b| {
            let a_time = match a {
                AttachmentEntityReference::Channel(c) => c.attachment_created_at,
                AttachmentEntityReference::Generic(g) => g.created_at,
            };
            let b_time = match b {
                AttachmentEntityReference::Channel(c) => c.attachment_created_at,
                AttachmentEntityReference::Generic(g) => g.created_at,
            };
            b_time.cmp(&a_time)
        });

        Ok(references)
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

    async fn batch_get_channel_previews(
        &self,
        channel_ids: &[String],
        viewer_user_id: &str,
        _org_id: Option<i64>,
    ) -> Result<Vec<ChannelPreviewRow>, Self::Err> {
        let rows = sqlx::query_as!(
            ChannelPreviewQueryRow,
            r#"
            SELECT
                c.id,
                c.name,
                c.channel_type AS "channel_type: ChannelType",
                c.org_id,
                c.team_id,
                CASE WHEN (
                    c.channel_type = 'public'
                    OR
                    (c.channel_type IN ('private', 'direct_message', 'team') AND EXISTS (
                        SELECT 1 FROM comms_channel_participants cp
                        WHERE cp.channel_id = c.id
                        AND cp.user_id = $2
                        AND cp.left_at IS NULL
                    ))
                ) THEN true ELSE false END AS "has_access!: bool"
            FROM comms_channels c
            WHERE c.id::text = ANY($1)
            "#,
            channel_ids,
            viewer_user_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("unable to batch get channel previews")?;

        Ok(rows
            .into_iter()
            .map(|row| ChannelPreviewRow {
                info: ChannelInfo {
                    id: row.id,
                    name: row.name,
                    channel_type: row.channel_type,
                    org_id: row.org_id,
                    team_id: row.team_id,
                },
                has_access: row.has_access,
            })
            .collect())
    }

    async fn resolve_channel_name(
        &self,
        info: &ChannelInfo,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<String, Self::Err> {
        resolve_channel_display_name(&self.pool, info, viewer_user_id).await
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
        _org_id: Option<i64>,
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
            None::<i64>,
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
                sender_id,
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
        mutated_message_from_row(row)
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

    async fn create_entity_mention(
        &self,
        options: CreateEntityMentionOptions,
    ) -> Result<EntityMention, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();
        let mention = sqlx::query_as!(
            EntityMention,
            r#"
            INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at
            "#,
            id,
            options.source_entity_type,
            options.source_entity_id,
            options.entity_type,
            options.entity_id,
            options.user_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to create entity mention")?;
        Ok(mention)
    }

    async fn get_entity_mention_by_id(&self, id: Uuid) -> Result<Option<EntityMention>, Self::Err> {
        let mention = sqlx::query_as!(
            EntityMention,
            r#"
            SELECT id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at
            FROM comms_entity_mentions
            WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch entity mention")?;
        Ok(mention)
    }

    async fn delete_entity_mention_by_id(&self, id: Uuid) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM comms_entity_mentions
            WHERE id = $1
            "#,
            id,
        )
        .execute(&self.pool)
        .await
        .context("failed to delete entity mention")?;
        Ok(result.rows_affected() > 0)
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
                sender_id,
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
        mutated_message_from_row(row)
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
                sender_id,
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
        mutated_message_from_row(row)
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
                sender_id,
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
        mutated_message_from_row(row)
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
            WHERE channel_id = $1 AND left_at IS NULL
            ORDER BY joined_at DESC
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let user_id = MacroUserIdStr::try_from(row.user_id).ok()?;
                Some(ChannelParticipant {
                    channel_id: row.channel_id,
                    user_id: user_id.as_ref().to_string(),
                    role: row.role,
                    joined_at: row.joined_at,
                    left_at: row.left_at,
                })
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

    async fn get_activities(&self, user_id: String) -> Result<Vec<Activity>, Self::Err> {
        let activities = sqlx::query!(
            r#"
        SELECT
            a.id as "id!: Uuid",
            a.user_id as "user_id!: String",
            a.channel_id as "channel_id!: Uuid",
            a.viewed_at as "viewed_at?: DateTime<Utc>",
            a.interacted_at as "interacted_at?: DateTime<Utc>",
            a.created_at as "created_at!: DateTime<Utc>",
            a.updated_at as "updated_at!: DateTime<Utc>"
        FROM comms_activity a
        WHERE a.user_id = $1
        ORDER BY
            GREATEST(
                COALESCE(a.viewed_at, '1970-01-01'::timestamp),
                COALESCE(a.interacted_at, '1970-01-01'::timestamp)
            ) DESC,
            a.created_at DESC
        LIMIT 100
        "#,
            user_id
        )
        .map(|row| Activity {
            id: row.id,
            user_id: row.user_id,
            channel_id: row.channel_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            viewed_at: row.viewed_at,
            interacted_at: row.interacted_at,
        })
        .fetch_all(&self.pool)
        .await?;
        Ok(activities)
    }

    async fn set_activity(
        &self,
        user_id: String,
        channel_id: Uuid,
        activity_type: ActivityType,
    ) -> Result<Activity, Self::Err> {
        let activity = match activity_type {
            ActivityType::View => {
                sqlx::query_as!(
                    Activity,
                    r#"
                INSERT INTO comms_activity (
                    id,
                    user_id,
                    channel_id,
                    viewed_at
                )
                VALUES (
                    $1, $2, $3, NOW()
                )
                ON CONFLICT (user_id, channel_id) DO UPDATE
                SET
                    viewed_at = NOW(),
                    updated_at = NOW()
                RETURNING
                    id as "id!: Uuid",
                    user_id as "user_id!: String",
                    channel_id as "channel_id!: Uuid",
                    created_at as "created_at!: DateTime<Utc>",
                    updated_at as "updated_at!: DateTime<Utc>",
                    viewed_at as "viewed_at?: DateTime<Utc>",
                    interacted_at as "interacted_at?: DateTime<Utc>"
                "#,
                    macro_uuid::generate_uuid_v7(),
                    user_id,
                    channel_id,
                )
                .fetch_one(&self.pool)
                .await?
            }
            ActivityType::Interact => {
                sqlx::query_as!(
                    Activity,
                    r#"
                INSERT INTO comms_activity (
                    id,
                    user_id,
                    channel_id,
                    interacted_at
                )
                VALUES (
                    $1, $2, $3, NOW()
                )
                ON CONFLICT (user_id, channel_id) DO UPDATE
                SET
                    interacted_at = NOW(),
                    updated_at = NOW()
                RETURNING
                    id as "id!: Uuid",
                    user_id as "user_id!: String",
                    channel_id as "channel_id!: Uuid",
                    created_at as "created_at!: DateTime<Utc>",
                    updated_at as "updated_at!: DateTime<Utc>",
                    viewed_at as "viewed_at?: DateTime<Utc>",
                    interacted_at as "interacted_at?: DateTime<Utc>"
                "#,
                    macro_uuid::generate_uuid_v7(),
                    user_id,
                    channel_id,
                )
                .fetch_one(&self.pool)
                .await?
            }
        };
        Ok(activity)
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

    async fn get_bot_profiles(
        &self,
        bot_ids: &[BotId],
    ) -> Result<HashMap<BotId, BotSenderProfile>, Self::Err> {
        if bot_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let ids: Vec<Uuid> = bot_ids.iter().map(|id| id.as_uuid()).collect();
        // Soft-deleted bots are included on purpose so historical messages
        // keep their sender identity.
        let rows = sqlx::query!(
            r#"
            SELECT id, name, avatar_url
            FROM bots
            WHERE id = ANY($1)
            "#,
            &ids,
        )
        .fetch_all(&self.pool)
        .await
        .context("unable to fetch bot profiles")?;

        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    BotId::from_uuid(row.id),
                    BotSenderProfile {
                        name: row.name,
                        avatar_url: row.avatar_url,
                    },
                )
            })
            .collect())
    }
}
