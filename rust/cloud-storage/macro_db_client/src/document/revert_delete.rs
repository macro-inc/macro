use anyhow::Context;

/// Reverts a document deletion
/// Adds the document back to the users history as well
#[tracing::instrument(skip(db))]
pub async fn revert_delete_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    project_id: Option<&str>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    // Remove deletedAt for document
    let document_owner = sqlx::query!(
        r#"
        UPDATE "Document"
        SET "deletedAt" = NULL
        WHERE id = $1
        RETURNING owner as owner
        "#,
        document_id,
    )
    .map(|row| row.owner)
    .fetch_one(&mut *transaction)
    .await
    .context("unable to update document")?;

    // Add document back to history
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW();
        "#,
        document_owner,
        document_id,
        "document",
    )
    .execute(&mut *transaction)
    .await
    .context("unable to add document to history")?;

    if let Some(project_id) = project_id {
        tracing::trace!("document was in nested");
        let is_deleted = sqlx::query!(
            r#"
            SELECT "deletedAt" as deleted_at FROM "Project" WHERE "id" = $1
            "#,
            project_id
        )
        .map(|row| row.deleted_at)
        .fetch_one(&mut *transaction)
        .await?;

        if is_deleted.is_some() {
            tracing::trace!("project is deleted, removing document from project");

            sqlx::query!(
                r#"
                UPDATE "Document" SET "projectId" = NULL WHERE "id" = $1
                "#,
                document_id
            )
            .execute(&mut *transaction)
            .await?;
        }
    }

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document")))]
    async fn test_revert_delete_document(pool: Pool<Postgres>) -> anyhow::Result<()> {
        revert_delete_document(&pool, "document-one", None).await?;

        let document = sqlx::query!(
            r#"
            SELECT "deletedAt" as deleted_at FROM "Document" WHERE id = $1
            "#,
            "document-one"
        )
        .map(|row| row.deleted_at)
        .fetch_one(&pool)
        .await?;

        assert!(document.is_none());

        let _history = sqlx::query!(
            r#"
            SELECT "createdAt" as created_at, "updatedAt" as updated_at FROM "UserHistory" WHERE "userId" = $1 AND "itemId" = $2
            "#,
            "macro|user@user.com",
            "document-one"
        )
        .fetch_one(&pool)
        .await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document")))]
    async fn test_revert_delete_document_nested_deleted_parent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // insert new parent for document-one that is deleted
        sqlx::query!(
            r#"
            INSERT INTO "Project" ("id", "name", "userId", "deletedAt")
            VALUES ('p1', 'd', 'macro|user@user.com', '2019-10-16 00:00:00')
            "#
        )
        .execute(&pool)
        .await?;

        // update document-one to have parent p1
        sqlx::query!(
            r#"
            UPDATE "Document" SET "projectId" = 'p1' WHERE "id" = 'document-one'
            "#
        )
        .execute(&pool)
        .await?;

        revert_delete_document(&pool, "document-one", Some("p1")).await?;

        let project_id = sqlx::query!(
            r#"
            SELECT "projectId" as project_id FROM "Document" WHERE "id" = 'document-one'
            "#
        )
        .map(|row| row.project_id)
        .fetch_one(&pool)
        .await?;

        assert!(project_id.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document")))]
    async fn test_revert_delete_document_nested_not_deleted_parent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // insert new parent for document-one that is deleted
        sqlx::query!(
            r#"
            INSERT INTO "Project" ("id", "name", "userId")
            VALUES ('p1', 'd', 'macro|user@user.com')
            "#
        )
        .execute(&pool)
        .await?;

        // update document-one to have parent p1
        sqlx::query!(
            r#"
            UPDATE "Document" SET "projectId" = 'p1' WHERE "id" = 'document-one'
            "#
        )
        .execute(&pool)
        .await?;

        revert_delete_document(&pool, "document-one", Some("p1")).await?;

        let project_id = sqlx::query!(
            r#"
            SELECT "projectId" as project_id FROM "Document" WHERE "id" = 'document-one'
            "#
        )
        .map(|row| row.project_id)
        .fetch_one(&pool)
        .await?;

        assert!(project_id.is_some());

        Ok(())
    }
}
