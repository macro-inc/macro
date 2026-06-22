//! Service layer (inbound port) for ai projections.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};

use crate::domain::{
    ai_projection_repo::AiProjectionRepository,
    model::{AiProjectionError, UpsertProjectionError, UpsertProjectionParams, UserAiProjection},
};

/// The permission required to read professional (premium) features.
pub const READ_PROFESSIONAL_FEATURES: &str = "read:professional_features";

/// The AiProjectionService defines the high-level operations for ai projections.
pub trait AiProjectionService: Clone + Send + Sync + 'static {
    /// Gets or creates a projection definition and the requesting user's cold
    /// instance of it, returning that instance.
    fn upsert_projection(
        &self,
        user_id: &MacroUserIdStr<'_>,
        params: UpsertProjectionParams,
    ) -> impl Future<Output = Result<UserAiProjection, UpsertProjectionError>> + Send;

    /// Returns whether the user has the `read:professional_features` permission.
    fn has_professional_features(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, AiProjectionError>> + Send;
}

/// Implementation of [`AiProjectionService`] backed by an [`AiProjectionRepository`].
#[derive(Debug, Clone)]
pub struct AiProjectionServiceImpl<R>
where
    R: AiProjectionRepository,
{
    repository: R,
}

impl<R> AiProjectionServiceImpl<R>
where
    R: AiProjectionRepository,
{
    /// Creates a new AiProjectionServiceImpl.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

/// Computes the prompt version hash used as part of a projection's cache key.
pub fn hash_prompt(prompt: &str) -> String {
    let digest = Sha256::digest(prompt.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

impl<R> AiProjectionService for AiProjectionServiceImpl<R>
where
    R: AiProjectionRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn upsert_projection(
        &self,
        user_id: &MacroUserIdStr<'_>,
        params: UpsertProjectionParams,
    ) -> Result<UserAiProjection, UpsertProjectionError> {
        if params.id.trim().is_empty() {
            return Err(UpsertProjectionError::BadRequest(
                "projection id cannot be empty".to_string(),
            ));
        }
        if params.prompt.trim().is_empty() {
            return Err(UpsertProjectionError::BadRequest(
                "projection prompt cannot be empty".to_string(),
            ));
        }

        let prompt_hash = hash_prompt(&params.prompt);

        let projection = self
            .repository
            .get_or_create_projection(
                &params.id,
                &params.prompt,
                &prompt_hash,
                params.refresh_cadence,
                params.expiry,
            )
            .await?;

        let user_projection = self
            .repository
            .get_or_create_user_projection(&projection.id, user_id, &projection.prompt_hash)
            .await?;

        Ok(user_projection)
    }

    #[tracing::instrument(skip(self), err)]
    async fn has_professional_features(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, AiProjectionError> {
        self.repository
            .user_has_permission(user_id, READ_PROFESSIONAL_FEATURES)
            .await
    }
}
