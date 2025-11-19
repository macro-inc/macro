use anyhow::Context;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

const FETCH_EMAIL_ATTACHMENTS_QUERY: &str = r#"
SELECT ID FROM "Document" d 
INNER JOIN public.document_email de ON d.id = de.document_id 
WHERE d.owner = $1;
"#;

/// Creates and returns a new PostgreSQL connection pool.
pub async fn create_db_pool(database_url: &str, min_connections: u32) -> anyhow::Result<PgPool> {
    PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(60)
        .connect(database_url)
        .await
        .context("Could not connect to db")
}

/// Fetches the document ids of attachments we have uploaded for the user
pub async fn fetch_document_ids(db: &PgPool, macro_id: &str) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(FETCH_EMAIL_ATTACHMENTS_QUERY)
        .bind(macro_id)
        .fetch_all(db)
        .await
        .context("Failed to fetch document IDs")?;

    Ok(rows)
}
