use anyhow::Result;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_documents_count(db: &Pool<Postgres>) -> Result<usize> {
    match sqlx::query!(
        r#"
            SELECT COUNT(*) as "count"
            FROM "Document" d
            WHERE d."deletedAt" IS NULL
        "#,
    )
    .fetch_one(db)
    .await
    {
        Ok(document_count) => match document_count.count {
            Some(count) => Ok(count as usize),
            None => Ok(0),
        },
        Err(err) => {
            tracing::error!(error=?err, "error getting document count");
            Err(err.into())
        }
    }
}
