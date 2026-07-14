/// Gets a documents shas using it's document version id
#[tracing::instrument(skip(db))]
pub async fn get_document_shas(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_version_id: i64,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
    SELECT 
        bp.sha
    FROM "BomPart" bp
    WHERE bp."documentBomId" = $1
    "#,
        document_version_id
    )
    .map(|r| r.sha)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets a documents shas using it's document id
#[tracing::instrument(skip(db))]
pub async fn get_document_shas_by_document_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
    SELECT 
        bp.sha
    FROM "BomPart" bp
    JOIN "DocumentBom" db ON bp."documentBomId" = db.id
    WHERE db."documentId" = $1
    AND db.id = (
        SELECT db_inner.id
        FROM "DocumentBom" db_inner
        WHERE db_inner."documentId" = $1
        ORDER BY db_inner."updatedAt" DESC
        LIMIT 1
    )
    "#,
        document_id
    )
    .map(|r| r.sha)
    .fetch_all(db)
    .await?;

    Ok(result)
}
