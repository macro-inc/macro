use super::DocumentTextOutcome;
use anyhow::Result;
use lambda_runtime::tracing;
use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

#[tracing::instrument(skip(db))]
pub async fn create_document_text(
    db: Pool<Postgres>,
    document_id: &str,
    text: &str,
    token_count: i64,
) -> Result<DocumentTextOutcome> {
    let inserted = sqlx::query_as!(
        DocumentText,
        r#"
            INSERT INTO "DocumentText" ("documentId", "content", "tokenCount")
            VALUES ($1, $2, $3)
            ON CONFLICT ("documentId") DO UPDATE 
            SET "content" = $2, "tokenCount" = $3
        "#,
        document_id,
        text,
        token_count
    )
    .execute(&db)
    .await;

    match inserted {
        Ok(_) => Ok(DocumentTextOutcome::Stored),
        // "DocumentText" has a single foreign key, to "Document"
        Err(e)
            if e.as_database_error()
                .is_some_and(|e| e.is_foreign_key_violation()) =>
        {
            Ok(DocumentTextOutcome::DocumentMissing)
        }
        Err(e) => Err(e.into()),
    }
}
