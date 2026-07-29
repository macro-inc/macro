//! Chat access extractor.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model::chat::ChatBasic;

/// Validates that the user has at least the required access level to a chat.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
///
/// # Prerequisites
///
/// - Chat context must be loaded (`ChatBasic` in extensions)
#[derive(Debug)]
pub struct ChatAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ChatAccessLevelExtractor<T, Svc, Auth>
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
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?
            .authorization;

        let chat_context: Extension<ChatBasic> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        if let Some(MacroAuthorization::Bot(authentication)) = authorization.as_ref() {
            let receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &chat_context.id,
                EntityType::Chat,
            )
            .await?;

            if chat_context.deleted_at.is_some()
                && !matches!(
                    receipt.entity_permission(),
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner
                    }
                )
            {
                return Err(ExtractorError::UnauthorizedWithMessage(
                    "only owner can access deleted resource",
                ));
            }

            return Ok(Self {
                entity_access_receipt: receipt,
                _marker: PhantomData,
            });
        }

        let is_internal_access = authorization
            .as_ref()
            .is_some_and(MacroAuthorization::is_internal);
        let macro_user_id = authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone());

        if macro_user_id.is_none() && is_internal_access {
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

        // Bots always resolve ownership through the scoped domain policy.
        if let Some(ref user_id) = macro_user_id
            && chat_context.user_id == *user_id
        {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: chat_context.id.clone(),
                        entity_type: EntityType::Chat,
                    },
                    auth: EntityAccessAuth::Authenticated(user_id.clone()),
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
                    .map(EntityAccessAuth::Authenticated)
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
