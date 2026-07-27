//! Thread (email thread) access extractor.

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

use super::{ExtractorError, RequiredPermission, bot::generate_bot_entity_access_receipt};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
/// Validates that the user has at least the required access level to an email thread.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
/// Type parameter `Auth` is the authorization service implementation.
///
/// Extracts the thread ID from the `thread_id` path parameter.
#[derive(Debug)]
pub struct ThreadAccessLevelExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ThreadAccessLevelExtractor<T, Svc, Auth>
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

        let Path(path_params): Path<HashMap<String, String>> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::BadRequest("missing thread_id path parameter"))?;

        let thread_id = path_params
            .get("thread_id")
            .ok_or(ExtractorError::BadRequest(
                "missing thread_id path parameter",
            ))?
            .clone();

        if let Some(MacroAuthorization::Bot(authentication)) = authorization.as_ref() {
            let entity_access_receipt = generate_bot_entity_access_receipt::<T>(
                service.as_ref(),
                authentication,
                &thread_id,
                EntityType::EmailThread,
            )
            .await?;

            return Ok(Self {
                entity_access_receipt,
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
                        entity_id: thread_id,
                        entity_type: EntityType::EmailThread,
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
            .get_access_level(
                macro_user_id.as_deref(),
                &thread_id,
                EntityType::EmailThread,
            )
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
                    entity_id: thread_id,
                    entity_type: EntityType::EmailThread,
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
