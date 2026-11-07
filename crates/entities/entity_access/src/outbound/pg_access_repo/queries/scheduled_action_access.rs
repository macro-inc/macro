//! Scheduled-action grants in `entity_access`.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use sqlx::PgPool;

/// Highest grant the caller's sources hold on one scheduled action.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_scheduled_action_access(
    pool: &PgPool,
    id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        SELECT access_level AS "access_level!: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'scheduled_action' AND source_id = ANY($2)
        "#,
        id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

/// Live scheduled-action ids the caller's sources can reach.
///
/// The join drops grants whose action row is gone.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn accessible_scheduled_action_ids(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT ea.entity_id
        FROM entity_access ea
        JOIN scheduled_action sa ON sa.id = ea.entity_id
        WHERE ea.entity_type = 'scheduled_action' AND ea.source_id = ANY($1)
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await
}
