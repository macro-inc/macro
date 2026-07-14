//! Foreign entity access extractor.

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use uuid::Uuid;

use super::{ExtractorError, InternalUser, RequiredPermission};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model_user::axum_extractor::MacroUserExtractor;

/// Validates that the user satisfies the required permission for a foreign entity.
///
/// Foreign entities grant View access only. The extractor reads either
/// `foreign_entity_id` or `id` from the route path parameters.
#[derive(Debug)]
pub struct ForeignEntityAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for ForeignEntityAccessLevelExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
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

        let internal_user: Option<Extension<InternalUser>> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        if internal_user.is_some() {
            return Self::from_permission(
                foreign_entity_id,
                EntityAccessAuth::Internal,
                view_permission(),
            );
        }

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Unauthorized)?;

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

impl<T: RequiredPermission, Svc> ForeignEntityAccessLevelExtractor<T, Svc> {
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
