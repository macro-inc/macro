//! Thread (email thread) access extractor.

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

use super::{ExtractorError, InternalUser, RequiredPermission};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model_user::axum_extractor::OptionalMacroUserExtractor;

/// Validates that the user has at least the required access level to an email thread.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// Extracts the thread ID from the `thread_id` path parameter.
#[derive(Debug)]
pub struct ThreadAccessLevelExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

impl<T, S, Svc> FromRequestParts<S> for ThreadAccessLevelExtractor<T, Svc>
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
