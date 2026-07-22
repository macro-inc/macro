//! Channel access extractor.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

use super::ExtractorError;
use crate::domain::{
    models::{
        Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
        ParticipantRole, RequiredPermission,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationService, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    UserOrInternalService, UserOrInternalServiceAuthorization,
};
#[derive(Debug, serde::Deserialize)]
struct ChannelAccessParams {
    channel_id: String,
}

/// Authorizes a request and validates that its identity satisfies the required channel permission.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
#[derive(Debug)]
pub struct ChannelAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ChannelAccessLevelExtractor<T, Svc, Auth>
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

        let Path(ChannelAccessParams { channel_id }) = parts
            .extract::<Path<ChannelAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing channel_id path parameter"))?;

        if macro_user_id.is_none() && is_internal_access {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: channel_id,
                        entity_type: EntityType::Channel,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::ChannelRole {
                        role: ParticipantRole::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        let Some(macro_user_id) = macro_user_id else {
            return Err(ExtractorError::Unauthorized);
        };

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &channel_id,
                EntityType::Channel,
                user_context.organization_id.map(i64::from),
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: channel_id,
                    entity_type: EntityType::Channel,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
