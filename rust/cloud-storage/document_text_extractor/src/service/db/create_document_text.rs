use anyhow::Result;
use lambda_runtime::tracing;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn create_document_text(
    db: Pool<Postgres>,
    document_id: &str,
    text: &str,
    token_count: i64,
) -> Result<()> {
    sqlx::query_as!(
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
    .await?;

    Ok(())
}
