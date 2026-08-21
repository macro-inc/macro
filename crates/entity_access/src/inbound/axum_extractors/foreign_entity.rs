//! Foreign entity access extractor.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use uuid::Uuid;

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};

/// Validates that the user satisfies the required permission for a foreign entity.
///
/// Foreign entities grant View access only. The extractor reads either
/// `foreign_entity_id` or `id` from the route path parameters.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
#[derive(Debug)]
pub struct ForeignEntityAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ForeignEntityAccessLevelExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let Path(path_params): Path<HashMap<String, String>> =
            parts.extract().await.map_err(|_| {
                ExtractorError::BadRequest("missing foreign_entity_id or id path parameter")
            })?;
        let foreign_entity_id = extract_foreign_entity_id(&path_params)?.to_string();

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;

        if let Some(MacroAuthorization::Bot(authentication)) = &authorization.authorization {
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &foreign_entity_id,
                EntityType::ForeignEntity,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
                _marker: PhantomData,
            });
        }

        let is_internal_access = authorization
            .authorization
            .as_ref()
            .is_some_and(MacroAuthorization::is_internal);
        let macro_user_id = authorization
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone());

        if macro_user_id.is_none() && is_internal_access {
            return Self::from_permission(
                foreign_entity_id,
                EntityAccessAuth::Internal,
                view_permission(),
            );
        }

        let Some(macro_user_id) = macro_user_id else {
            return Err(ExtractorError::Unauthorized);
        };

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &foreign_entity_id,
                EntityType::ForeignEntity,
                None,
            )
            .await
            .map_err(ExtractorError::from)?;

        Self::from_permission(
            foreign_entity_id,
            EntityAccessAuth::Authenticated(macro_user_id),
            permission,
        )
    }
}

impl<T: RequiredPermission, Svc, Auth> ForeignEntityAccessLevelExtractor<T, Svc, Auth> {
    fn from_permission(
        foreign_entity_id: String,
        auth: EntityAccessAuth,
        entity_permission: EntityPermission,
    ) -> Result<Self, ExtractorError> {
        if !entity_permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: foreign_entity_id,
                    entity_type: EntityType::ForeignEntity,
                },
                auth,
                entity_permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}

fn extract_foreign_entity_id(
    path_params: &HashMap<String, String>,
) -> Result<Uuid, ExtractorError> {
    let raw_id = path_params
        .get("foreign_entity_id")
        .or_else(|| path_params.get("id"))
        .ok_or(ExtractorError::BadRequest(
            "missing foreign_entity_id or id path parameter",
        ))?;

    Uuid::parse_str(raw_id)
        .map_err(|_| ExtractorError::BadRequest("invalid foreign entity ID format"))
}

fn view_permission() -> EntityPermission {
    EntityPermission::AccessLevel {
        access_level: AccessLevel::View,
    }
}
