/// Get all the documents from a list of project ids
#[tracing::instrument(skip(db))]
pub async fn get_documents_from_project_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "id" FROM "Document" WHERE "projectId" = ANY($1)
        "#,
        project_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Get all deleted documents from a list of project ids
#[tracing::instrument(skip(db))]
pub async fn get_deleted_documents_from_project_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_ids: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<Vec<(String, String)>> {
    let project_ids: Vec<String> = project_ids.iter().map(|s| s.to_string()).collect();
    let result = sqlx::query!(
        r#"
        SELECT id, owner FROM "Document" WHERE "projectId" = ANY($1) AND "deletedAt" IS NOT NULL
        "#,
        &project_ids
    )
    .map(|row| (row.id, row.owner))
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(db))]
pub async fn get_document_permission_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_ids: &Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "sharePermissionId" as id FROM "DocumentPermission" WHERE "documentId" = ANY($1)
        "#,
        document_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}
