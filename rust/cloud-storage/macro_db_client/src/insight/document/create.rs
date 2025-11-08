use anyhow::{Context, Error};
use chrono::{DateTime, Utc};
use model::insight_context::document::DocumentSummary;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn create_document_summaries<'e, E>(
    db: E,
    summaries: Vec<DocumentSummary>,
) -> Result<Vec<DocumentSummary>, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let (document_ids, version_ids, summaries) = summaries
        .into_iter()
        .map(|summary| (summary.document_id, summary.version_id, summary.summary))
        .collect::<(Vec<_>, Vec<_>, Vec<_>)>();

    sqlx::query_as!(
        DocumentSummary,
        r#"
            INSERT INTO "DocumentSummary" (
                document_id,   
                version_id, 
                summary
            )
            SELECT 
                u.document_id, u.version_id, u.summary
            FROM 
                UNNEST($1::text[], $2::text[], $3::text[])
                AS u(document_id, version_id, summary)
            RETURNING 
                id as "id?",  
                "createdAt" as "created_at?: DateTime<Utc>",
                document_id,
                version_id, 
                summary
        "#,
        &document_ids,
        &version_ids,
        &summaries
    )
    .fetch_all(db)
    .await
    .context("failed to insert into document summaries")
}
