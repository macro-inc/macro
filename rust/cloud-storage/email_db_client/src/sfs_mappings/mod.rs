use anyhow::Context;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

/// Fetches a single mapping from source URL to destination URL
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_sfs_mapping(pool: &PgPool, source: &str) -> anyhow::Result<Option<String>> {
    let record = sqlx::query!(
        r#"
        SELECT destination
        FROM email_sfs_mappings
        WHERE source = $1
        "#,
        source
    )
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to fetch SFS mapping for source: {}", source))?;

    Ok(record.map(|r| r.destination))
}

/// Fetches mappings from source URLs to destination URLs
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_sfs_mappings(
    pool: &PgPool,
    sources: &HashSet<String>,
) -> anyhow::Result<HashMap<String, String>> {
    if sources.is_empty() {
        return Ok(HashMap::new());
    }

    // Convert HashSet to Vec for the query
    let sources_vec: Vec<String> = sources.iter().cloned().collect();

    let records = sqlx::query!(
        r#"
        SELECT source, destination
        FROM email_sfs_mappings
        WHERE source = ANY($1)
        "#,
        &sources_vec
    )
    .fetch_all(pool)
    .await
    .with_context(|| format!("Failed to fetch SFS mappings for sources: {:?}", sources))?;

    let mappings: HashMap<String, String> = records
        .into_iter()
        .map(|record| (record.source, record.destination))
        .collect();

    Ok(mappings)
}

/// Inserts multiple source to destination URL mappings into the email_sfs_mappings table
#[tracing::instrument(skip(pool, mappings), level = "info")]
pub async fn insert_sfs_mappings(
    pool: &PgPool,
    mappings: &HashMap<String, String>,
) -> anyhow::Result<u64> {
    if mappings.is_empty() {
        return Ok(0);
    }

    // Convert the HashMap into two vectors for the query
    let mut sources = Vec::with_capacity(mappings.len());
    let mut destinations = Vec::with_capacity(mappings.len());

    for (source, destination) in mappings {
        // extremely large urls can't be inserted due to size limits on indexes in postgres.
        if source.len() > 2000 {
            continue;
        }
        sources.push(source.clone());
        destinations.push(destination.clone());
    }

    let result = sqlx::query!(
        r#"
        INSERT INTO email_sfs_mappings (source, destination)
        SELECT * FROM UNNEST($1::text[], $2::text[])
        ON CONFLICT (source) DO NOTHING
        "#,
        &sources,
        &destinations
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to insert SFS mappings for {} source/destination pairs",
            mappings.len()
        )
    })?;

    Ok(result.rows_affected())
}
