#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;

#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // The entity_access + SharePermission join is the follow-up query task.
    // Returning None keeps exhaustive matches compiling without a new sqlx::query!.
    let _ = (pool, initiative_id, source_ids);
    Ok(None)
}

#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    list_entity_access_grants(pool, initiative_id, EntityType::Initiative, source_ids).await
}
