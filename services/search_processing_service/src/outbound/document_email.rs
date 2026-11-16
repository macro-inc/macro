//! Reads of `document_email`, the links from documents to the email
//! attachments they were imported from.

use sqlx::PgPool;

/// Whether a `document_email` row links the document to an email attachment:
/// one probe of the primary key, which leads with `document_id`.
#[tracing::instrument(skip(db), err)]
pub async fn is_email_attachment(db: &PgPool, document_id: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM document_email WHERE document_id = $1) AS "is_email_attachment!""#,
        document_id
    )
    .fetch_one(db)
    .await
}

#[cfg(test)]
mod test;
