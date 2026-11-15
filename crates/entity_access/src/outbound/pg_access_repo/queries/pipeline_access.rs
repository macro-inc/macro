//! Pipeline grants, resolved through the caller's current sharing sources.

#[cfg(test)]
mod test;

use super::Viewer;
use crate::domain::models::AccessLevel;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

/// Highest grant on each pipeline, including trashed pipelines for restoration.
pub(crate) async fn list_pipeline_access(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT p.id, ea.access_level AS "access_level!: AccessLevel"
           FROM crm_pipeline_entities p JOIN entity_access ea ON ea.entity_id = p.id AND ea.entity_type = 'crm_pipeline'
           WHERE ea.source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, NULL) s(source)))"#,
        user_id.as_ref(),
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
pub(crate) async fn get_pipeline_access(
    pool: &PgPool,
    id: Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(
        "SELECT access_level::text FROM entity_access WHERE entity_id = $1 AND entity_type = 'crm_pipeline' AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))",
        id, viewer.id(), viewer.scope_team(),
    ).fetch_all(pool).await?;
    super::database_access::highest_access_level(&levels)
}

/// Highest grant on each of `ids`, reading only those pipelines' grants.
/// Pipelines without a grant are left out.
pub(crate) async fn get_pipelines_access(
    pool: &PgPool,
    ids: &[Uuid],
    viewer: Viewer<'_>,
) -> Result<HashMap<Uuid, AccessLevel>, sqlx::Error> {
    // Probes each pipeline's few grants by entity, then each grant's source
    // against the caller's memberships, as `get_pipeline_access` does.
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
           WHERE EXISTS (SELECT FROM entity_access_source_matches(grant_row.source_id, $2, $3))"#,
        ids,
        viewer.id(),
        viewer.scope_team(),
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
