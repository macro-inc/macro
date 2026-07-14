use agent::types::ChatMessageContent;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSearchBackfill {
    pub chat_id: String,
    pub message_id: String,
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Gets the chat messages for search backfill.
///
/// Pagination is **keyset (seek-method)**: pass `cursor` as the last
/// row's `(updated_at, message_id)` pair from the previous page (or
/// `None` for the first page). Sorting and filtering use `updatedAt`
/// rather than `createdAt` so incremental backfills (e.g. "anything
/// changed since X") catch messages that were edited after the cutoff.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
pub async fn get_chat_messages_for_search_backfill(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    chat_ids: Option<&Vec<String>>,
    user_ids: Option<&Vec<String>>,
    updated_after: Option<DateTime<Utc>>,
    updated_before: Option<DateTime<Utc>>,
    only_deleted: Option<bool>,
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    if let Some(chat_ids) = chat_ids {
        if chat_ids.is_empty() {
            return Ok(vec![]);
        }

        return get_chat_messages_for_search_backfill_chat_ids(
            db,
            limit,
            cursor,
            chat_ids,
            updated_after,
            updated_before,
            only_deleted,
        )
        .await;
    }

    if let Some(user_ids) = user_ids {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }

        return get_chat_messages_for_search_backfill_user_ids(
            db,
            limit,
            cursor,
            user_ids,
            updated_after,
            updated_before,
            only_deleted,
        )
        .await;
    }

    let (cursor_updated_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };

    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            m."createdAt" as "created_at",
            m."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            (
                $2::bool IS NULL
                OR ($2 AND c."deletedAt" IS NOT NULL)
                OR (NOT $2 AND c."deletedAt" IS NULL)
            )
            AND ($3::timestamptz IS NULL OR m."updatedAt" >= $3)
            AND ($4::timestamptz IS NULL OR m."updatedAt" < $4)
            AND (
                $5::timestamptz IS NULL
                OR (m."updatedAt", m.id) > ($5, $6::text)
            )
        ORDER BY m."updatedAt" ASC, m.id ASC
        LIMIT $1
        "#,
        limit,
        only_deleted as Option<bool>,
        updated_after as Option<DateTime<Utc>>,
        updated_before as Option<DateTime<Utc>>,
        cursor_updated_at as Option<DateTime<Utc>>,
        cursor_id as Option<String>,
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
#[allow(clippy::too_many_arguments)]
async fn get_chat_messages_for_search_backfill_chat_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    chat_ids: &[String],
    updated_after: Option<DateTime<Utc>>,
    updated_before: Option<DateTime<Utc>>,
    only_deleted: Option<bool>,
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    let (cursor_updated_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };

    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            m."createdAt" as "created_at",
            m."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            m."chatId" = ANY($1)
            AND (
                $3::bool IS NULL
                OR ($3 AND c."deletedAt" IS NOT NULL)
                OR (NOT $3 AND c."deletedAt" IS NULL)
            )
            AND ($4::timestamptz IS NULL OR m."updatedAt" >= $4)
            AND ($5::timestamptz IS NULL OR m."updatedAt" < $5)
            AND (
                $6::timestamptz IS NULL
                OR (m."updatedAt", m.id) > ($6, $7::text)
            )
        ORDER BY m."updatedAt" ASC, m.id ASC
        LIMIT $2
        "#,
        chat_ids,
        limit,
        only_deleted as Option<bool>,
        updated_after as Option<DateTime<Utc>>,
        updated_before as Option<DateTime<Utc>>,
        cursor_updated_at as Option<DateTime<Utc>>,
        cursor_id as Option<String>,
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
#[allow(clippy::too_many_arguments)]
async fn get_chat_messages_for_search_backfill_user_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    user_ids: &[String],
    updated_after: Option<DateTime<Utc>>,
    updated_before: Option<DateTime<Utc>>,
    only_deleted: Option<bool>,
) -> anyhow::Result<Vec<ChatSearchBackfill>> {
    let (cursor_updated_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };

    let result = sqlx::query!(
        r#"
        SELECT
            c."id" as "chat_id",
            m.id as "message_id",
            c."userId" as "user_id",
            m."createdAt" as "created_at",
            m."updatedAt" as "updated_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            c."userId" = ANY($1)
            AND (
                $3::bool IS NULL
                OR ($3 AND c."deletedAt" IS NOT NULL)
                OR (NOT $3 AND c."deletedAt" IS NULL)
            )
            AND ($4::timestamptz IS NULL OR m."updatedAt" >= $4)
            AND ($5::timestamptz IS NULL OR m."updatedAt" < $5)
            AND (
                $6::timestamptz IS NULL
                OR (m."updatedAt", m.id) > ($6, $7::text)
            )
        ORDER BY m."updatedAt" ASC, m.id ASC
        LIMIT $2
        "#,
        user_ids,
        limit,
        only_deleted as Option<bool>,
        updated_after as Option<DateTime<Utc>>,
        updated_before as Option<DateTime<Utc>>,
        cursor_updated_at as Option<DateTime<Utc>>,
        cursor_id as Option<String>,
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

/// Chat message info used for search indexing. `deleted_at` is set when the
/// owning chat has been soft-deleted, allowing the indexer to remove the
/// message from the search index instead of upserting it.
#[derive(Debug, Clone)]
pub struct ChatMessageInfo {
    pub name: String,
    pub content: String,
    pub role: String,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Gets the chat title, message content and role used for search.
/// Returns `None` when the message does not exist. Soft-deleted chats are
/// returned with `deleted_at` populated so the caller can prune the search
/// index entry.
#[tracing::instrument(skip(db))]
pub async fn get_chat_message_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    chat_message_id: &str,
) -> anyhow::Result<Option<ChatMessageInfo>> {
    let result = sqlx::query!(
        r#"
        SELECT
            m.content as "content",
            c.name as "name",
            m.role as "role",
            c."deletedAt"::timestamptz as "deleted_at"
        FROM
            "ChatMessage" m
        JOIN
            "Chat" c on c."id" = m."chatId"
        WHERE
            m.id = $1 AND m."chatId" = $2
        "#,
        chat_message_id,
        chat_id
    )
    .fetch_optional(db)
    .await?;

    let Some(row) = result else {
        return Ok(None);
    };

    let content = serde_json::from_value::<ChatMessageContent>(row.content)?.message_text();
    Ok(Some(ChatMessageInfo {
        name: row.name,
        content,
        role: row.role,
        deleted_at: row.deleted_at,
    }))
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
