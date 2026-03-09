//! Channel access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

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
struct ChannelAccessParams {
    channel_id: String,
}

/// Validates that the user satisfies the required permission for a channel.
///
/// Type parameter `T` specifies the required permission marker.
/// Type parameter `Svc` is the entity access service implementation.
#[derive(Debug)]
pub struct ChannelAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for ChannelAccessLevelExtractor<T, Svc>
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

        let Path(ChannelAccessParams { channel_id }) = parts
            .extract::<Path<ChannelAccessParams>>()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing channel_id path parameter"))?;

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
                auth: EntityAccessAuth::Authenticated(macro_user_id.0),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
