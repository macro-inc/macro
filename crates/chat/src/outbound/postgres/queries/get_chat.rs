//! Fetch a chat by ID.

use model::chat::Chat;
use model_owner::Owner;
use sqlx::PgPool;

/// Fetch a single chat row by its ID.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_chat(pool: &PgPool, chat_id: &str) -> anyhow::Result<Chat> {
    let chat = sqlx::query!(
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
    .try_map(|row| {
        Ok(Chat {
            id: row.id,
            name: row.name,
            user_id: Owner::from_principal_str(&row.user_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            model: Some(row.model),
            project_id: row.project_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            token_count: row.token_count,
            is_persistent: row.is_persistent,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_one(pool)
    .await?;

    Ok(chat)
}
