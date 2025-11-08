use anyhow::Result;
use model::chat::Chat;
use sqlx::Postgres;

pub async fn get_latest_single_attachment_chat(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    attachment_id: &str,
    user_id: &str,
) -> Result<Option<Chat>, sqlx::Error> {
    sqlx::query_as!(
        Chat,
        r#"
            WITH SingleAttachmentChats AS (
                SELECT
                    "chatId",
                    COUNT(*) as attachment_count
                FROM "ChatAttachment"
                GROUP BY "chatId"
                HAVING COUNT(*) = 1
            )
            SELECT
                c.id,
                c.name,
                c."userId" as "user_id",
                c."createdAt"::timestamptz as "created_at",
                c."updatedAt"::timestamptz as "updated_at",
                c."deletedAt"::timestamptz as "deleted_at",
                c.model,
                c."tokenCount" as "token_count",
                c."projectId" as "project_id",
                c."isPersistent" as "is_persistent"
            FROM "Chat" c
            INNER JOIN "ChatAttachment" ca ON c.id = ca."chatId"
            INNER JOIN SingleAttachmentChats sac ON c.id = sac."chatId"
            WHERE
                ca."attachmentId" = $1 AND c."userId" = $2
                AND
                c."deletedAt" IS NULL

            ORDER BY c."updatedAt" DESC
            LIMIT 1;
        "#,
        attachment_id,
        user_id,
    )
    .fetch_optional(transaction.as_mut())
    .await
}

pub async fn get_multi_attachment_chat(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    attachment_id: &str,
    user_id: &str,
) -> Result<Vec<Chat>, sqlx::Error> {
    sqlx::query_as!(
        Chat,
        r#"
            WITH MultiAttachmentChats AS (
                SELECT
                    "chatId",
                    COUNT(*) as attachment_count
                FROM "ChatAttachment"
                GROUP BY "chatId"
            )
            SELECT
                c.id,
                c.name,
                c."userId" as "user_id",
                c."createdAt"::timestamptz as "created_at",
                c."updatedAt"::timestamptz as "updated_at",
                c."deletedAt"::timestamptz as "deleted_at",
                c.model,
                c."tokenCount" as "token_count",
                c."projectId" as "project_id",
                c."isPersistent" as "is_persistent"
            FROM "Chat" c
            INNER JOIN "ChatAttachment" ca ON c.id = ca."chatId"
            INNER JOIN MultiAttachmentChats mac ON c.id = mac."chatId"
            WHERE
                ca."attachmentId" = $1 AND c."userId" = $2
                    AND
                c."deletedAt" IS NULL
            ORDER BY c."updatedAt" DESC;
        "#,
        attachment_id,
        user_id,
    )
    .fetch_all(transaction.as_mut())
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("chat_example")))]
    async fn test_get_latest_single_attachment_chat(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        let chat = get_latest_single_attachment_chat(
            &mut transaction,
            "document-two",
            "macro|user@user.com",
        )
        .await?;
        assert!(chat.is_some());
        assert_eq!(chat.unwrap().id, "chat-two".to_string());
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("chat_example")))]
    async fn test_get_multi_attachment_chat(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        let chat =
            get_multi_attachment_chat(&mut transaction, "document-two", "macro|user@user.com")
                .await?;
        assert_eq!(chat.len(), 3);
        Ok(())
    }
}
