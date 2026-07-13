//! This module contains db queries to filter out a list of provided documents and only return those
//! matching the criteria

/// Given a list of document ids and a list of file types, this will
/// return a subset list of items that are of the provided file types.
#[tracing::instrument(skip(db), err)]
pub async fn filter_documents_by_file_types(
    db: &sqlx::PgPool,
    documents: &[String],
    file_types: &[String],
) -> anyhow::Result<Vec<String>> {
    let documents = sqlx::query!(
        r#"
        SELECT
            d.id
        FROM
            "Document" d
        WHERE
            d.id = ANY($1)
            AND d."fileType" = ANY($2)
        "#,
        documents,
        file_types,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(documents)
}
