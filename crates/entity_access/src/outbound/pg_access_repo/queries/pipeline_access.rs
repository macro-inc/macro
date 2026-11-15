//! Pipeline grants, resolved through the caller's current sharing sources.

use super::SourceIds;
use crate::domain::models::AccessLevel;
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

/// Highest grant on each pipeline, including trashed pipelines for restoration.
pub async fn list_pipeline_access(
    pool: &PgPool,
    sources: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT p.id, ea.access_level AS "access_level!: AccessLevel"
           FROM crm_pipeline_entities p JOIN entity_access ea ON ea.entity_id = p.id AND ea.entity_type = 'crm_pipeline'
           WHERE ea.source_id = ANY($1)"#,
        &sources.0,
    ).fetch_all(pool).await?;
    let mut grants = BTreeMap::<Uuid, AccessLevel>::new();
    for row in rows {
        grants
            .entry(row.id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(grants.into_iter().collect())
}

/// Resolve one pipeline without enumerating the caller's other pipelines.
pub async fn get_pipeline_access(
    pool: &PgPool,
    id: Uuid,
    sources: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(
        "SELECT access_level::text FROM entity_access WHERE entity_id = $1 AND entity_type = 'crm_pipeline' AND source_id = ANY($2)",
        id, &sources.0,
    ).fetch_all(pool).await?;
    super::database_access::highest_access_level(&levels)
}

/// Highest grant on each of `ids`, reading only those pipelines' grants.
/// Pipelines without a grant are left out.
pub async fn get_pipelines_access(
    pool: &PgPool,
    ids: &[Uuid],
    sources: &SourceIds,
) -> Result<HashMap<Uuid, AccessLevel>, sqlx::Error> {
    // Probes each pipeline's few grants, fenced so a generic plan doesn't
    // start from the caller's sources instead: a member of many channels has
    // hundreds of them.
    let rows = sqlx::query!(
        r#"SELECT grant_row.entity_id AS "entity_id!",
                  grant_row.access_level AS "access_level!: AccessLevel"
           FROM UNNEST($1::uuid[]) AS pipeline(id)
           CROSS JOIN LATERAL (
               SELECT ea.entity_id, ea.access_level, ea.source_id
               FROM entity_access ea
               WHERE ea.entity_id = pipeline.id AND ea.entity_type = 'crm_pipeline'
               OFFSET 0
           ) AS grant_row
           WHERE grant_row.source_id = ANY($2)"#,
        ids,
        &sources.0,
    )
    .fetch_all(pool)
    .await?;
    let mut grants = HashMap::<Uuid, AccessLevel>::new();
    for row in rows {
        grants
            .entry(row.entity_id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(grants)
}
