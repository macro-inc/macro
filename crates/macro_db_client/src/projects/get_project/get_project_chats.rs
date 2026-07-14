/// Get all the chats from a list of project ids
#[tracing::instrument(skip(db))]
pub async fn get_chats_from_project_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "id" FROM "Chat" WHERE "projectId" = ANY($1)
        "#,
        project_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Get all deleted chats from a list of project ids
/// Returns the id and the owner of the chat
#[tracing::instrument(skip(db))]
pub async fn get_deleted_chats_from_project_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<Vec<(String, String)>> {
    let project_ids: Vec<String> = project_ids.iter().map(|s| s.to_string()).collect();
    let result = sqlx::query!(
        r#"
        SELECT "id", "userId" as user_id FROM "Chat" WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids
    )
    .map(|row| (row.id, row.user_id))
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(db))]
pub async fn get_chat_permission_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "sharePermissionId" as id FROM "ChatPermission" WHERE "chatId" = ANY($1)
        "#,
        chat_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}
