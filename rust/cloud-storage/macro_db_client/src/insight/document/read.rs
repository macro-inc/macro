use anyhow::{Context, Error};
use chrono::{DateTime, Utc};
use model::insight_context::document::DocumentSummary;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_document_summaries<'e, E>(
    db: E,
    document_ids: &[String],
) -> Result<Vec<DocumentSummary>, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_as!(
        DocumentSummary,
        r#"
            SELECT DISTINCT ON("document_id") 
                "id" as "id?",
                "document_id",
                "version_id",
                "createdAt" as "created_at?: DateTime<Utc>",
                "summary"
            FROM "DocumentSummary"
            WHERE document_id = ANY($1)
            ORDER BY "document_id", "createdAt" DESC
    "#,
        document_ids
    )
    .fetch_all(db)
    .await
    .context("failed to fetch document summaries")
}
