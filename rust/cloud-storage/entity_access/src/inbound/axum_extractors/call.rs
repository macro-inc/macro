//! Call access extractors.
//!
//! Resolves a call (from both `calls` and `call_records` tables), checks channel
//! membership, and exposes the call's `share_permission_id` for downstream handlers.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use uuid::Uuid;

use super::{ExtractorError, InternalUser};
use crate::domain::{
    models::{
        Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
        ParticipantRole, RequiredPermission,
    },
    ports::EntityAccessService,
};
use model_user::axum_extractor::OptionalMacroUserExtractor;

#[derive(Debug, serde::Deserialize)]
struct CallAccessParams {
    call_id: String,
}

#[derive(Debug, serde::Deserialize)]
struct CallWithChannelIdAccessParams {
    channel_id: String,
}

/// Validates that the user satisfies the required permission for the channel
/// that a call belongs to, using a `call_id` path parameter.
///
/// Resolves the call from both `calls` (active) and `call_records` (archived)
/// tables, then checks the user's channel membership.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
#[derive(Debug)]
pub struct CallAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt (entity is the channel the call belongs to).
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The call's share permission ID.
    pub share_permission_id: String,
    /// The channel ID the call belongs to.
    pub channel_id: Uuid,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for CallAccessLevelExtractor<T, Svc>
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

        let OptionalMacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Path(CallAccessParams { call_id }) = parts
            .extract::<Path<CallAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing call_id path parameter"))?;

        let call_id_uuid = Uuid::parse_str(&call_id)
            .map_err(|_| ExtractorError::BadRequest("invalid call_id format"))?;

        let call_info = service
            .get_call_channel(&call_id_uuid)
            .await
            .map_err(ExtractorError::from)?
            .ok_or(ExtractorError::NotFound("call not found"))?;

        let internal_user: Option<Extension<InternalUser>> = if macro_user_id.is_none() {
            parts
                .extract()
                .await
                .map_err(|_| ExtractorError::Internal)?
        } else {
            None
        };

        if internal_user.is_some() {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: call_id,
                        entity_type: EntityType::Call,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::ChannelRole {
                        role: ParticipantRole::Owner,
                    },
                    _marker: PhantomData,
                },
                share_permission_id: call_info.share_permission_id,
                channel_id: call_info.channel_id,
                _marker: PhantomData,
            });
        }

        let Some(macro_user_id) = macro_user_id else {
            return Err(ExtractorError::Unauthorized);
        };

        let user_org_id = user_context.organization_id.map(i64::from);
        let channel_id_str = call_info.channel_id.to_string();

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &channel_id_str,
                EntityType::Channel,
                user_org_id,
            )
            .await
            .map_err(ExtractorError::from)?;

        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: call_id,
                    entity_type: EntityType::Call,
                },
                auth: EntityAccessAuth::Authenticated(macro_user_id),
                entity_permission: permission,
                _marker: PhantomData,
            },
            share_permission_id: call_info.share_permission_id,
            channel_id: call_info.channel_id,
            _marker: PhantomData,
        })
    }
}

/// Validates that the user satisfies the required permission for a call's channel,
/// using a `channel_id` path parameter.
///
/// Resolves the call from both `calls` (active) and `call_records` (archived)
/// tables by channel ID, then checks the user's channel membership.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
#[derive(Debug)]
pub struct CallWithChannelIdAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt (entity is the channel the call belongs to).
    pub entity_access_receipt: EntityAccessReceipt<T>,
    /// The call's share permission ID.
    pub share_permission_id: String,
    /// The channel ID.
    pub channel_id: Uuid,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for CallWithChannelIdAccessLevelExtractor<T, Svc>
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

        let OptionalMacroUserExtractor {
            macro_user_id,
            user_context,
            ..
        } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Path(CallWithChannelIdAccessParams { channel_id }) = parts
            .extract::<Path<CallWithChannelIdAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing channel_id path parameter"))?;

        let channel_id_uuid = Uuid::parse_str(&channel_id)
            .map_err(|_| ExtractorError::BadRequest("invalid channel_id format"))?;

        let call_info = service
            .get_call_channel_by_channel_id(&channel_id_uuid)
            .await
            .map_err(ExtractorError::from)?
            .ok_or(ExtractorError::NotFound("call not found for channel"))?;

        let internal_user: Option<Extension<InternalUser>> = if macro_user_id.is_none() {
            parts
                .extract()
                .await
                .map_err(|_| ExtractorError::Internal)?
        } else {
            None
        };

        if internal_user.is_some() {
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
                share_permission_id: call_info.share_permission_id,
                channel_id: channel_id_uuid,
                _marker: PhantomData,
            });
        }

        let Some(macro_user_id) = macro_user_id else {
            return Err(ExtractorError::Unauthorized);
        };

        let user_org_id = user_context.organization_id.map(i64::from);

        let permission = service
            .get_entity_permission(
                Some(&macro_user_id),
                &channel_id,
                EntityType::Channel,
                user_org_id,
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
            share_permission_id: call_info.share_permission_id,
            channel_id: channel_id_uuid,
            _marker: PhantomData,
        })
    }
}
