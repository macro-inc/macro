//! Generic entity permission extractor.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use macro_authorization::{
    MacroAuthorizationService, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    UserOrInternalService, UserOrInternalServiceAuthorization,
};

use super::ExtractorError;
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
        ViewAccessLevel,
    },
    ports::EntityAccessService,
};

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
pub struct EntityPermissionExtractor<Svc, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    _marker: PhantomData<(Svc, Auth)>,
}

impl<S, Svc, Auth> FromRequestParts<S> for EntityPermissionExtractor<Svc, Auth>
where
    Arc<Svc>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, UserOrInternalService>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;
        let is_internal_access = authorization
            .authorization
            .as_ref()
            .is_some_and(UserOrInternalServiceAuthorization::is_internal);
        let (macro_user_id, user_context) = authorization
            .authorization
            .as_ref()
            .and_then(UserOrInternalServiceAuthorization::acting_user)
            .map(|user| (Some(user.macro_user_id.clone()), user.user_context.clone()))
            .unwrap_or_default();

        let Path(EntityPermissionParams {
            entity_type,
            entity_id,
        }) = <Path<EntityPermissionParams>>::from_request_parts(parts, state)
            .await
            .map_err(|_| ExtractorError::BadRequest("Missing entity_type or entity_id in path"))?;

        let parsed_type = parse_entity_type(&entity_type)?;

        if is_internal_access && macro_user_id.is_none() {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id,
                        entity_type: parsed_type,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: internal_access_level(parsed_type),
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        let user_org_id = user_context.organization_id.map(|id| id as i64);

        let permission = match macro_user_id.as_ref() {
            Some(macro_user_id) => service
                .get_entity_permission(Some(macro_user_id), &entity_id, parsed_type, user_org_id)
                .await
                .map_err(ExtractorError::from)?,
            None => {
                // For unauthenticated users, check public access at View level
                let access_level = service
                    .check_public_access(&entity_id, parsed_type, AccessLevel::View)
                    .await
                    .map_err(ExtractorError::from)?;
                EntityPermission::AccessLevel { access_level }
            }
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id,
                    entity_type: parsed_type,
                },
                auth: macro_user_id
                    .map(EntityAccessAuth::Authenticated)
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}

fn internal_access_level(entity_type: EntityType) -> AccessLevel {
    match entity_type {
        EntityType::ForeignEntity => AccessLevel::View,
        _ => AccessLevel::Owner,
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
