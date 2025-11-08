use tracing::instrument;

/// Gets the instructions document ID for a user
#[instrument(skip(db))]
pub async fn get_instructions_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Option<String>> {
    tracing::trace!("getting instructions document");

    let result = sqlx::query!(
        r#"
            SELECT "documentId" as "document_id"
            FROM "InstructionsDocuments" id
            JOIN "Document" d ON d."id" = id."documentId"
            WHERE "userId" = $1 AND d."deletedAt" IS NULL
        "#,
        user_id,
    )
    .fetch_optional(db)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, user_id=%user_id, "unable to get instructions document");
        anyhow::anyhow!("unable to get instructions document: {}", err)
    })?;

    Ok(result.map(|r| r.document_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instructions::create::create_instructions_document;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_instructions_document_exists(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";

        // First create an instructions document
        let created_document_id = create_instructions_document(&pool, user_id)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create instructions document: {:?}", e))?;

        // Then get it
        let result = get_instructions_document(&pool, user_id).await?;

        assert!(result.is_some());
        assert_eq!(result.unwrap(), created_document_id);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_instructions_document_not_exists(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";

        // Try to get instructions document without creating one first
        let result = get_instructions_document(&pool, user_id).await?;

        assert!(result.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_instructions_document_different_users(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user1 = "macro|user@user.com";
        let user2 = "macro|user2@user.com";

        // Add second user to the database (only if it doesn't exist)
        let _ = sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING"#,
            user2,
            "user2@user.com"
        )
        .execute(&pool)
        .await;

        // Create instructions document for user1 only
        let user1_document_id = create_instructions_document(&pool, user1)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create instructions document: {:?}", e))?;

        // User1 should get their document
        let user1_result = get_instructions_document(&pool, user1).await?;
        assert!(user1_result.is_some());
        assert_eq!(user1_result.unwrap(), user1_document_id);

        // User2 should get None
        let user2_result = get_instructions_document(&pool, user2).await?;
        assert!(user2_result.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_instructions_document_nonexistent_user(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let nonexistent_user = "nonexistent|user@fake.com";

        // Should return None for non-existent user
        let result = get_instructions_document(&pool, nonexistent_user).await?;
        assert!(result.is_none());

        Ok(())
    }
}
