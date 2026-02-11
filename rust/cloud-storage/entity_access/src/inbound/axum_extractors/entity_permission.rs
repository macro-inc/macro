//! Generic entity permission extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

use super::ExtractorError;
use crate::domain::{
    models::{EntityPermission, EntityType},
    ports::EntityAccessService,
};
use model_user::axum_extractor::MacroUserExtractor;

/// Path parameters for entity permission routes.
#[derive(serde::Deserialize)]
struct EntityPermissionParams {
    entity_type: String,
    entity_id: String,
}

/// Extracts the user's [`EntityPermission`] for a given entity.
///
/// Reads `{entity_type}` and `{entity_id}` from path parameters and resolves
/// the user's permission via `EntityAccessService::get_entity_permission`.
#[derive(Debug)]
pub struct EntityPermissionExtractor<Svc> {
    /// The resolved permission.
    pub permission: EntityPermission,
    _marker: PhantomData<Svc>,
}

#[async_trait]
impl<S, Svc> FromRequestParts<S> for EntityPermissionExtractor<Svc>
where
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let MacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Path(EntityPermissionParams {
            entity_type,
            entity_id,
        }) = <Path<EntityPermissionParams>>::from_request_parts(parts, state)
            .await
            .map_err(|_| ExtractorError::BadRequest("Missing entity_type or entity_id in path"))?;

        let parsed_type = parse_entity_type(&entity_type)?;
        let user_org_id = user_context.organization_id.map(|id| id as i64);

        let permission = service
            .get_entity_permission(&macro_user_id, &entity_id, parsed_type, user_org_id)
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self {
            permission,
            _marker: PhantomData,
        })
    }
}

/// Parse entity type string to [`EntityType`], handling the "email_thread" → "thread" alias.
fn parse_entity_type(s: &str) -> Result<EntityType, ExtractorError> {
    // "thread" in the API maps to EmailThread
    let normalized = if s == "thread" { "email_thread" } else { s };
    normalized
        .parse()
        .map_err(|_| ExtractorError::BadRequest("Invalid entity type"))
}
