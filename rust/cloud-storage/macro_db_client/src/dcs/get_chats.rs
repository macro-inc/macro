use model::chat::Chat;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_chats(db: &Pool<Postgres>, user_id: &str) -> anyhow::Result<Vec<Chat>> {
    let mut chats: Vec<Chat> = Vec::new();
    chats.extend(
        sqlx::query_as!(
            Chat,
            r#"
        SELECT
            c.id,
            c.name,
            c.model,
            c."tokenCount" as "token_count",
            c."userId" as "user_id",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."deletedAt"::timestamptz as "deleted_at",
            c."projectId" as "project_id",
            c."isPersistent" as "is_persistent"
        FROM "Chat" c
        WHERE c."userId" = $1 AND c."deletedAt" IS NULL
        "#,
            user_id,
        )
        .fetch_all(db)
        .await?,
    );

    Ok(chats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("chat_example")))]
    async fn test_get_chats(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let chats = get_chats(&pool, "macro|user@user.com").await?;
        assert_eq!(chats.len(), 3);
        Ok(())
    }
}
