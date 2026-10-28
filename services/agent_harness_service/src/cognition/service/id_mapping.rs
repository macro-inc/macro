//! Database operations for the id_mapping table.
//!
//! Provides a simple key-value store for mapping source IDs to target IDs.
//! Used for persisting associations like tool_id -> document_id.

use anyhow::Result;
use sqlx::{Pool, Postgres};

/// Creates a mapping from source_id to target_id.
/// If the source_id already exists, updates the target_id.
#[tracing::instrument(err, skip(db))]
pub async fn create_id_mapping(
    db: &Pool<Postgres>,
    source_id: &str,
    target_id: &str,
) -> Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO id_mapping (source_id, target_id)
        VALUES ($1, $2)
        ON CONFLICT (source_id)
        DO UPDATE SET target_id = EXCLUDED.target_id
        "#,
        source_id,
        target_id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Gets the target_id for a given source_id.
/// Returns None if no mapping exists.
#[tracing::instrument(err, skip(db))]
pub async fn get_id_mapping(db: &Pool<Postgres>, source_id: &str) -> Result<Option<String>> {
    let result = sqlx::query!(
        r#"
        SELECT target_id
        FROM id_mapping
        WHERE source_id = $1
        "#,
        source_id
    )
    .fetch_optional(db)
    .await?;

    Ok(result.map(|r| r.target_id))
}

#[cfg(test)]
mod test;
