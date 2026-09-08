use anyhow::Context;

#[cfg(test)]
mod test;

/// Reverts a chat deletion
/// Adds the chat back to the users history as well.
/// The legacy project hint is ignored in favor of the persisted parent under the guard.
#[tracing::instrument(skip(db), err)]
pub async fn revert_delete_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    _project_id: Option<&str>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await.context("unable to begin transaction")?;
    entity_access_db_utils::team_share::acquire_guard(&mut transaction).await?;

    // Remove deletedAt for chat
    let chat = sqlx::query!(
        r#"
        UPDATE "Chat"
        SET "deletedAt" = NULL
        WHERE id = $1
        RETURNING "userId" as owner, "projectId" as project_id
        "#,
        chat_id,
    )
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
        chat.owner,
        chat_id,
        "chat",
    )
    .execute(&mut *transaction)
    .await
    .context("unable to add chat to history")?;

    if let Some(project_id) = chat.project_id {
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

    // Legacy text IDs cannot have UUID-keyed grants. Direct shares and their
    // canonical state are untouched, including shares cleared by lifecycle cleanup.
    if let Ok(id) = uuid::Uuid::parse_str(chat_id) {
        entity_access_db_utils::project_inheritance::synchronize_entity(
            &mut transaction,
            &id,
            model_entity::EntityType::Chat,
        )
        .await?;
    }

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(())
}
