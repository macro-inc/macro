//! Query for initiative access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;

/// Get the highest access level a user has for an initiative.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
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
