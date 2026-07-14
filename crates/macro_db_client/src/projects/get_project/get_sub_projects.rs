#[tracing::instrument(skip(db))]
pub async fn get_project_permission_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "sharePermissionId" as id FROM "ProjectPermission" WHERE "projectId" = ANY($1)
        "#,
        project_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}
