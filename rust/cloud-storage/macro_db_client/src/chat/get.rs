use ai::types::ChatMessageContent;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSearchBackfill {
    pub chat_id: String,
    pub message_id: String,
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Gets the chat messages for search backfill
#[tracing::instrument(skip(db))]
pub async fn get_chat_messages_for_search_backfill(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
    chat_ids: Option<&Vec<String>>,
    user_ids: Option<&Vec<String>>,
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    if let Some(chat_ids) = chat_ids {
        if chat_ids.is_empty() {
            return Ok(vec![]);
        }

        return get_chat_messages_for_search_backfill_chat_ids(db, limit, offset, chat_ids).await;
    }

    if let Some(user_ids) = user_ids {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }

        return get_chat_messages_for_search_backfill_user_ids(db, limit, offset, user_ids).await;
    }

    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            c."createdAt" as "created_at",
            c."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE c."deletedAt" IS NULL
        ORDER BY
            m."createdAt" DESC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| ChatSearchBackfill {
        chat_id: row.chat_id,
        message_id: row.message_id,
        user_id: row.user_id,
        created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
        updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets the chat messages for search backfill for specific chat ids
async fn get_chat_messages_for_search_backfill_chat_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
    chat_ids: &[String],
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            c."createdAt" as "created_at",
            c."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            m."chatId" = ANY($1) AND c."deletedAt" IS NULL
        ORDER BY
            m."createdAt" DESC
        LIMIT $2
        OFFSET $3
        "#,
        chat_ids,
        limit,
        offset
    )
    .map(|row| ChatSearchBackfill {
        chat_id: row.chat_id,
        message_id: row.message_id,
        user_id: row.user_id,
        created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
        updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets the chat messages for search backfill for specific user ids
async fn get_chat_messages_for_search_backfill_user_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
    user_ids: &[String],
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            c."createdAt" as "created_at",
            c."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            c."userId" = ANY($1) AND c."deletedAt" IS NULL
        ORDER BY
            m."createdAt" DESC
        LIMIT $2
        OFFSET $3
        "#,
        user_ids,
        limit,
        offset
    )
    .map(|row| ChatSearchBackfill {
        chat_id: row.chat_id,
        message_id: row.message_id,
        user_id: row.user_id,
        created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
        updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets the chat title, message content and role used for search
/// NOTE: this does not return persistent chats
#[tracing::instrument(skip(db))]
pub async fn get_chat_message_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    chat_message_id: &str,
) -> anyhow::Result<Option<(String, String, String)>> {
    let result = sqlx::query!(
        r#"
        SELECT
            m.content as "content",
            c.name as "name",
            m.role as "role"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            m.id = $1 AND m."chatId" = $2 AND c."deletedAt" IS NULL AND c."isPersistent" = false
        "#,
        chat_message_id,
        chat_id
    )
    .map(|row| (row.name, row.content, row.role))
    .fetch_optional(db)
    .await?;

    if let Some((name, content, role)) = result {
        return serde_json::from_value::<ChatMessageContent>(content)
            .map(|content| (name, content.message_text(), role))
            .map_err(anyhow::Error::from)
            .map(Some);
    }

    Ok(None)
}

/// Gets the chats metadata for updating the chat message metadata
#[tracing::instrument(skip(db))]
pub async fn get_chats_metadata_for_update(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
) -> anyhow::Result<String> {
    let title = sqlx::query!(
        r#"
        SELECT
            c.name
        FROM
            "Chat" c
        WHERE
            c.id = $1 AND c."deletedAt" IS NULL
        "#,
        chat_id
    )
    .map(|row| row.name)
    .fetch_one(db)
    .await?;

    Ok(title)
}

pub async fn get_chat_ids_by_user_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id"
        FROM
            "Chat" c
        WHERE
            c."userId" = $1 AND c."deletedAt" IS NULL
        "#,
        user_id
    )
    .map(|row| row.chat_id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets all chat IDs and their associated user IDs with pagination support
/// Returns a vector of tuples where each tuple is (chat_id, user_id)
#[tracing::instrument(skip(db))]
pub async fn get_all_chat_ids_with_users_paginated(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<(String, String)>> {
    let result = sqlx::query!(
        r#"
        SELECT
            id as "chat_id",
            "userId" as "user_id"
        FROM
            "Chat"
        WHERE
            "deletedAt" IS NULL
        ORDER BY
            "createdAt" DESC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| (row.chat_id, row.user_id))
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Returns a paginated list of chat IDs, sorting by ascending so we don't miss new ones
#[tracing::instrument(skip(db))]
pub async fn get_all_chat_ids_paginated(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT
            id as "chat_id"
        FROM
            "Chat"
        WHERE
            "deletedAt" IS NULL
        ORDER BY
            "createdAt" ASC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| row.chat_id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatHistoryInfo {
    pub item_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub project_id: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub user_id: String,
    pub name: String,
}

/// Gets chat history information including when a user last viewed each chat
/// Returns only entries that exist in the database
#[tracing::instrument(skip(db))]
pub async fn get_chat_history_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    chat_ids: &[String],
) -> anyhow::Result<HashMap<String, ChatHistoryInfo>> {
    if chat_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query!(
        r#"
        SELECT
            c."id" as "item_id!",
            c."createdAt" as "created_at!",
            c."updatedAt" as "updated_at!",
            c."deletedAt" as "deleted_at?",
            uh."updatedAt" as "viewed_at?",
            c."projectId" as "project_id?",
            c."userId" as "user_id",
            c."name"
        FROM
            "Chat" c
        LEFT JOIN
            "UserHistory" uh ON uh."itemId" = c."id"
                AND uh."userId" = $1
                AND uh."itemType" = 'chat'
        WHERE
            c."id" = ANY($2)
        ORDER BY
            c."updatedAt" DESC
        "#,
        user_id,
        chat_ids,
    )
    .fetch_all(db)
    .await?;

    let chat_history_map: HashMap<String, ChatHistoryInfo> = results
        .into_iter()
        .map(|row| {
            let info = ChatHistoryInfo {
                item_id: row.item_id.clone(),
                user_id: row.user_id,
                name: row.name,
                created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
                updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
                viewed_at: row
                    .viewed_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
                project_id: row.project_id,
                deleted_at: row
                    .deleted_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
            };
            (row.item_id, info)
        })
        .collect();

    Ok(chat_history_map)
}
