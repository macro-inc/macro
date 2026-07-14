use anyhow::Context;

/// Reverts a chat deletion
/// Adds the chat back to the users history as well
#[tracing::instrument(skip(db))]
pub async fn revert_delete_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    project_id: Option<&str>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;

    // Remove deletedAt for chat
    let chat_owner = sqlx::query!(
        r#"
        UPDATE "Chat"
        SET "deletedAt" = NULL
        WHERE id = $1
        RETURNING "userId" as owner
        "#,
        chat_id,
    )
    .map(|row| row.owner)
    .fetch_one(&mut *transaction)
    .await
    .context("unable to update chat")?;

    // Add chat back to history
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = NOW();
        "#,
        chat_owner,
        chat_id,
        "chat",
    )
    .execute(&mut *transaction)
    .await
    .context("unable to add chat to history")?;

    if let Some(project_id) = project_id {
        tracing::trace!("chat was in nested");
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
            tracing::trace!("project is deleted, removing chat from project");

            sqlx::query!(
                r#"
                UPDATE "Chat" SET "projectId" = NULL WHERE "id" = $1
                "#,
                chat_id
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
