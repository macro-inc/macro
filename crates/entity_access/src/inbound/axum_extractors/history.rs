//! History access extractor.

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
};

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
/// Path parameters for history routes.
#[derive(serde::Deserialize)]
pub struct HistoryParams {
    /// The ID of the item.
    pub item_id: String,
    /// The type of item (e.g., "document", "chat").
    pub item_type: String,
}

/// Validates the user has access to view the history of a particular item.
///
/// Extracts both `item_id` and `item_type` from the path parameters. Type parameter `T` specifies
/// the required access level, `Svc` is the entity access service, and `Auth` is the authorization
/// service.
#[derive(Debug)]
pub struct HistoryAccessExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for HistoryAccessExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let OptionalMacroAuthorizationExtractor {
            macro_user_id,
            is_internal_access,
            ..
        } = OptionalMacroAuthorizationExtractor::<Auth>::from_request_parts(parts, state)
            .await
            .map_err(ExtractorError::from)?;

        let Path(HistoryParams { item_id, item_type }) =
            <Path<HistoryParams>>::from_request_parts(parts, state)
                .await
                .map_err(|_| ExtractorError::BadRequest("Missing item_id or item_type in path"))?;

        // Parse the item_type string into EntityType
        let entity_type: EntityType = item_type
            .parse()
            .map_err(|_| ExtractorError::BadRequest("Invalid item_type"))?;

        if macro_user_id.is_none() && is_internal_access {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: item_id,
                        entity_type,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        let access_level = match service
            .get_access_level(macro_user_id.as_deref(), &item_id, entity_type)
            .await
            .map_err(ExtractorError::from)?
        {
            Some(access_level) => access_level,
            None => return Err(ExtractorError::Unauthorized),
        };

        let permission = EntityPermission::AccessLevel { access_level };
        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: item_id,
                    entity_type,
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
