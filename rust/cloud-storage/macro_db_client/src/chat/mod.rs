use model::chat::ChatBasic;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;

pub mod delete;
pub mod get;
pub mod patch;
pub mod preview;
pub mod read;
pub mod revert_delete;

pub async fn get_basic_chat(db: &Pool<Postgres>, chat_id: &str) -> Result<ChatBasic, sqlx::Error> {
    let chat: ChatBasic = sqlx::query_as!(
        ChatBasic,
        r#"
        SELECT
            c.id as "id",
            c.name as "name",
            c."projectId" as "project_id",
            c."userId" as "user_id",
            c."deletedAt"::timestamptz as "deleted_at"
        FROM
            "Chat" c
        WHERE
            c.id = $1
    "#,
        chat_id,
    )
    .fetch_one(db)
    .await?;

    Ok(chat)
}

pub async fn get_chats_to_delete(
    db: &Pool<Postgres>,
    date: &chrono::NaiveDateTime,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
            SELECT c.id
            FROM "Chat" c
            WHERE c."deletedAt" IS NOT NULL AND c."deletedAt" <= $1
        "#,
        date
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Get unique chat IDs for a set of message IDs
pub async fn get_chat_ids_for_messages(
    db: &Pool<Postgres>,
    message_ids: &[String],
) -> Result<HashSet<String>, sqlx::Error> {
    let records = sqlx::query!(
        r#"
        SELECT DISTINCT m."chatId" as chat_id
        FROM "ChatMessage" m
        WHERE m."id" = ANY($1)
        "#,
        message_ids
    )
    .fetch_all(db)
    .await?;

    Ok(records.into_iter().map(|r| r.chat_id).collect())
}
