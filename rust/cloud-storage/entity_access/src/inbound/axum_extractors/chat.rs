//! Chat access extractor.

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
use model::chat::ChatBasic;
use model_user::axum_extractor::MacroUserExtractor;

/// Validates that the user has at least the required access level to a chat.
///
/// Type parameter `T` specifies the required access level.
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - User must be authenticated (MacroUserExtractor in extensions)
/// - Chat context must be loaded (ChatBasic in extensions)
#[derive(Debug)]
pub struct ChatAccessLevelExtractor<T, Svc> {
    /// The actual access level the user has.
    pub access_level: AccessLevel,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for ChatAccessLevelExtractor<T, Svc>
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

        let chat_context: Extension<ChatBasic> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        // Owner always has full access
        if chat_context.user_id == macro_user_id {
            return Ok(Self {
                access_level: AccessLevel::Owner,
                _marker: PhantomData,
            });
        }

        // Deleted items are only accessible by owner
        if chat_context.deleted_at.is_some() {
            return Err(ExtractorError::Unauthorized);
        }

        // Check access via service
        let required_level = T::required_level();
        let access_level = service
            .check_access(
                &macro_user_id,
                &chat_context.id,
                EntityType::Chat,
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
