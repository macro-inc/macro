//! Pipeline grants, resolved through the caller's current sharing sources.

use super::SourceIds;
use crate::domain::models::AccessLevel;
use sqlx::PgPool;
use std::collections::BTreeMap;
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
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *tx)
        .await?;
    let levels = sqlx::query_scalar!(
        "SELECT ea.access_level::text FROM entity_access ea
         WHERE ea.entity_id = $1 AND ea.entity_type = 'crm_pipeline' AND ea.source_id = ANY($2)",
        id,
        &sources.0,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    super::database_access::highest_access_level(&levels)
}

/// Fresh sharing sources for a CRM pipeline read. Team grants follow current
/// CRM authority; direct and channel grants remain independent of that setting.
#[tracing::instrument(skip_all, err)]
pub async fn user_sources(pool: &PgPool, viewer: Option<&str>) -> Result<SourceIds, sqlx::Error> {
    let Some(viewer) = viewer else {
        return Ok(SourceIds(Vec::new()));
    };
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '15s'")
        .execute(&mut *tx)
        .await?;
    let sources = sqlx::query_scalar!(
        r#"SELECT cp.channel_id::text AS "source_id!" FROM comms_channel_participants cp
           WHERE cp.user_id = $1 AND cp.left_at IS NULL
           UNION ALL
           SELECT tu.team_id::text FROM team_user tu
           WHERE tu.user_id = $1 AND (tu.crm_access OR tu.team_role <> 'member')
           UNION ALL
           SELECT $1"#,
        viewer,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(SourceIds(sources))
}
