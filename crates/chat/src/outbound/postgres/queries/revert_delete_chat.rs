use anyhow::Context;

#[tracing::instrument(err, skip(tx))]
pub(crate) async fn revert_delete_chat(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    chat_id: &str,
    project_id: Option<&str>,
) -> anyhow::Result<()> {
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
    .fetch_one(&mut **tx)
    .await
    .context("unable to update chat")?;

    let chat_uuid = macro_uuid::string_to_uuid(chat_id)?;
    entity_registry_db_utils::clear_deleted(tx, chat_uuid).await?;

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
    .execute(&mut **tx)
    .await
    .context("unable to add chat to history")?;

    if let Some(project_id) = project_id {
        let is_deleted = sqlx::query!(
            r#"
            SELECT "deletedAt" as deleted_at FROM "Project" WHERE "id" = $1
            "#,
            project_id
        )
        .map(|row| row.deleted_at)
        .fetch_one(&mut **tx)
        .await?;

        if is_deleted.is_some() {
            sqlx::query!(
                r#"
                UPDATE "Chat" SET "projectId" = NULL WHERE "id" = $1
                "#,
                chat_id
            )
            .execute(&mut **tx)
            .await?;
        }
    }

    Ok(())
}
