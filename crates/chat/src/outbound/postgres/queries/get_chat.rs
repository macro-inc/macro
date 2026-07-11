//! Fetch a chat by ID.

use model::chat::Chat;
use sqlx::PgPool;

/// Fetch a single chat row by its ID.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_chat(pool: &PgPool, chat_id: &str) -> anyhow::Result<Chat> {
    let chat = sqlx::query_as!(
        Chat,
        r#"
        SELECT
            id,
            name,
            model,
            "userId" as "user_id",
            "createdAt"::timestamptz as "created_at",
            "updatedAt"::timestamptz as "updated_at",
            "deletedAt"::timestamptz as "deleted_at",
            "projectId" as "project_id",
            "tokenCount" as "token_count",
            "isPersistent" as "is_persistent"
        FROM "Chat"
        WHERE id = $1
        "#,
        chat_id,
    )
    .fetch_one(pool)
    .await?;

    Ok(chat)
}
