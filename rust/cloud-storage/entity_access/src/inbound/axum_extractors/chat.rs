//! Chat access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, InternalUser, RequiredPermission};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model::chat::ChatBasic;
use model_user::axum_extractor::OptionalMacroUserExtractor;

/// Validates that the user has at least the required access level to a chat.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - Chat context must be loaded (ChatBasic in extensions)
#[derive(Debug)]
pub struct ChatAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for ChatAccessLevelExtractor<T, Svc>
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

        let OptionalMacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let chat_context: Extension<ChatBasic> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

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
                        entity_id: chat_context.id.clone(),
                        entity_type: EntityType::Chat,
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

        // Check ownership only if authenticated
        if let Some(ref user_id) = macro_user_id
            && chat_context.user_id == *user_id
        {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: chat_context.id.clone(),
                        entity_type: EntityType::Chat,
                    },
                    auth: EntityAccessAuth::Authenticated(user_id.clone().0),
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        // Deleted items are only accessible by owner
        if chat_context.deleted_at.is_some() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "only owner can access deleted resource",
            ));
        }

        let access_level = match service
            .get_access_level(macro_user_id.as_deref(), &chat_context.id, EntityType::Chat)
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
                    entity_id: chat_context.id.clone(),
                    entity_type: EntityType::Chat,
                },
                auth: macro_user_id
                    .map(|m| EntityAccessAuth::Authenticated(m.0))
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
