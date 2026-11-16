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

/// Given a list of document ids, this will return the subset whose email
/// attachment status is `is_email_attachment`. A document is an email
/// attachment while a `document_email` row links it to one, the same test
/// Soup's `isEmailAttachment` filter applies.
///
/// The list is every document a user can reach, so the lookup runs under a
/// statement timeout of its own. `OFFSET 0` keeps each id an index probe of
/// `document_email`: a semi-join on stale statistics hashes the whole table.
#[tracing::instrument(skip(db, documents), fields(documents = documents.len()), err)]
pub async fn filter_documents_by_email_attachment(
    db: &sqlx::PgPool,
    documents: &[String],
    is_email_attachment: bool,
) -> anyhow::Result<Vec<String>> {
    let mut transaction = db.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *transaction)
        .await?;

    let documents = if is_email_attachment {
        sqlx::query_scalar!(
            r#"
            SELECT d.id AS "id!"
            FROM unnest($1::text[]) AS d(id)
            WHERE EXISTS (
                SELECT 1 FROM document_email de WHERE de.document_id = d.id OFFSET 0
            )
            "#,
            documents,
        )
        .fetch_all(&mut *transaction)
        .await?
    } else {
        sqlx::query_scalar!(
            r#"
            SELECT d.id AS "id!"
            FROM unnest($1::text[]) AS d(id)
            WHERE NOT EXISTS (
                SELECT 1 FROM document_email de WHERE de.document_id = d.id OFFSET 0
            )
            "#,
            documents,
        )
        .fetch_all(&mut *transaction)
        .await?
    };
    transaction.commit().await?;

    Ok(documents)
}
