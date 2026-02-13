//! Thread (email thread) access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, InternalUser, RequiredAccessLevel};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model::thread::EmailThreadPermission;
use model_user::axum_extractor::OptionalMacroUserExtractor;

/// Validates that the user has at least the required access level to an email thread.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - Thread context must be loaded (EmailThreadPermission in extensions)
#[derive(Debug)]
pub struct ThreadAccessLevelExtractor<T, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for ThreadAccessLevelExtractor<T, Svc>
where
    T: RequiredAccessLevel,
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

        let thread_context: Extension<EmailThreadPermission> = parts
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
                        entity_id: thread_context.thread_id.clone(),
                        entity_type: EntityType::EmailThread,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                },
                _marker: PhantomData,
            });
        }

        let required_level = T::required_level();
        // Check access based on auth state
        let access_level: AccessLevel = match macro_user_id.as_ref() {
            Some(macro_user_id) => service
                .check_access(
                    Some(macro_user_id),
                    &thread_context.thread_id,
                    EntityType::EmailThread,
                    required_level,
                )
                .await
                .map_err(ExtractorError::from)?,
            None => service
                .check_public_access(
                    &thread_context.thread_id,
                    EntityType::EmailThread,
                    required_level,
                )
                .await
                .map_err(ExtractorError::from)?,
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: thread_context.thread_id.clone(),
                    entity_type: EntityType::EmailThread,
                },
                auth: macro_user_id
                    .map(|m| EntityAccessAuth::Authenticated(m.0))
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: EntityPermission::AccessLevel { access_level },
            },
            _marker: PhantomData,
        })
    }
}
