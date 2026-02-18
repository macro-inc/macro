#[cfg(test)]
mod test;

use sqlx::PgPool;

/// Insert a new active stream entry, ignoring conflicts.
pub(crate) async fn insert_active_stream(
    pool: &PgPool,
    entity_id: &str,
    stream_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO active_streams (entity_id, stream_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(entity_id)
    .bind(stream_key)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete an active stream entry.
pub(crate) async fn delete_active_stream(
    pool: &PgPool,
    entity_id: &str,
    stream_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM active_streams WHERE entity_id = $1 AND stream_key = $2")
        .bind(entity_id)
        .bind(stream_key)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get all stream keys for a given entity.
pub(crate) async fn get_active_stream_keys(
    pool: &PgPool,
    entity_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT stream_key FROM active_streams WHERE entity_id = $1")
            .bind(entity_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(key,)| key).collect())
}
