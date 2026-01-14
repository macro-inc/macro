//! Thread (email thread) access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, RequiredAccessLevel};
use crate::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::thread::EmailThreadPermission;
use model_user::axum_extractor::MacroUserExtractor;

/// Validates that the user has at least the required access level to an email thread.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - User context must be available (UserContext in extensions)
/// - Thread context must be loaded (EmailThreadPermission in extensions)
#[derive(Debug)]
pub struct ThreadAccessLevelExtractor<T, Svc> {
    /// The actual access level the user has.
    pub access_level: AccessLevel,
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

        let MacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let thread_context: Extension<EmailThreadPermission> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        // Check access via service
        let required_level = T::required_level();
        let access_level = service
            .check_access(
                &macro_user_id,
                &thread_context.thread_id,
                EntityType::EmailThread,
                required_level,
            )
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self {
            access_level,
            _marker: PhantomData,
        })
    }
}
