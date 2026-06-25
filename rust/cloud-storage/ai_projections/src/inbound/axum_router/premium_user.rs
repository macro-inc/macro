//! Extractor that ensures the authenticated user has professional features.

use axum::{
    Json,
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::{MacroUserExtractor, UserExtractorErr};

use crate::domain::{ai_projection_service::AiProjectionService, model::AiProjectionError};

use super::AiProjectionRouterState;

/// Extractor that ensures the authenticated user has the
/// `read:professional_features` permission.
pub struct PremiumUserExtractor {
    /// The authenticated professional user's id.
    pub macro_user_id: MacroUserIdStr<'static>,
}

/// Rejection returned when the professional features check fails.
#[derive(Debug, thiserror::Error)]
pub enum PremiumUserRejection {
    /// The user could not be extracted from the request.
    #[error(transparent)]
    User(#[from] UserExtractorErr),
    /// The user does not have the required permission.
    #[error("professional features required")]
    NotAuthorized,
    /// The permission check could not be performed.
    #[error(transparent)]
    Service(#[from] AiProjectionError),
}

impl IntoResponse for PremiumUserRejection {
    fn into_response(self) -> Response {
        match self {
            PremiumUserRejection::User(err) => err.into_response(),
            PremiumUserRejection::NotAuthorized => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "professional features required".into(),
                }),
            )
                .into_response(),
            PremiumUserRejection::Service(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            )
                .into_response(),
        }
    }
}

impl<T> FromRequestParts<AiProjectionRouterState<T>> for PremiumUserExtractor
where
    T: AiProjectionService,
{
    type Rejection = PremiumUserRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AiProjectionRouterState<T>,
    ) -> Result<Self, Self::Rejection> {
        let user = MacroUserExtractor::from_request_parts(parts, state).await?;

        if !state
            .service
            .has_professional_features(&user.macro_user_id)
            .await?
        {
            return Err(PremiumUserRejection::NotAuthorized);
        }

        Ok(Self {
            macro_user_id: user.macro_user_id,
        })
    }
}
