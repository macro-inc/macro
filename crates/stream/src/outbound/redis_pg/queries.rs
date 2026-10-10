#[cfg(test)]
mod test;
use crate::domain::StreamId;

use sqlx::PgPool;
use std::time::Duration;

/// Insert a new active stream entry, ignoring conflicts.
#[tracing::instrument(err, skip(pool))]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub(crate) async fn insert_active_stream(
    pool: &PgPool,
    stream_id: &StreamId,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO active_streams (entity_id, stream_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(&stream_id.entity_id)
    .bind(stream_id.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete an active stream entry.
#[tracing::instrument(err, skip(pool))]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub(crate) async fn delete_active_stream(
    pool: &PgPool,
    stream_id: &StreamId,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM active_streams WHERE entity_id = $1 AND stream_key = $2")
        .bind(&stream_id.entity_id)
        .bind(stream_id.to_string())
        .execute(pool)
        .await?;
    Ok(())
}

/// Mark a stream as closed. The row is kept so a subscriber that arrives
/// shortly after the stream ended is still replayed its tail; see
/// [`purge_closed_streams`] for the eventual removal.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn mark_stream_closed(
    pool: &PgPool,
    stream_id: &StreamId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE active_streams SET closed_at = now() WHERE entity_id = $1 AND stream_key = $2",
        stream_id.entity_id,
        stream_id.to_string(),
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete the rows of streams that were closed more than `older_than` ago.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn purge_closed_streams(
    pool: &PgPool,
    older_than: Duration,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!(
        "DELETE FROM active_streams WHERE closed_at < now() - make_interval(secs => $1)",
        older_than.as_secs_f64(),
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Stream keys of an entity's streams that are still being written to.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_active_stream_keys(
    pool: &PgPool,
    entity_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT stream_key FROM active_streams WHERE entity_id = $1 AND closed_at IS NULL",
        entity_id,
    )
    .fetch_all(pool)
    .await
}

/// Stream keys a new subscriber of an entity should be replayed: streams that
/// are still open plus streams closed less than `replay_window` ago.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_replayable_stream_keys(
    pool: &PgPool,
    entity_id: &str,
    replay_window: Duration,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT stream_key FROM active_streams \
         WHERE entity_id = $1 \
           AND (closed_at IS NULL OR closed_at > now() - make_interval(secs => $2))",
        entity_id,
        replay_window.as_secs_f64(),
    )
    .fetch_all(pool)
    .await
}
