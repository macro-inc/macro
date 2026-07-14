//! Extractor that ensures the authenticated user is a premium user.

use axum::{
    Json,
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationRejection, SharedMacroAuthorizationExtractor};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;

use crate::domain::{model::TeamError, team_repo::TeamService};

use super::TeamRouterState;

/// Extractor that ensures the authenticated user is a premium user
/// (has an active stripe subscription).
pub struct PremiumUserExtractor {
    /// The authenticated premium user's id.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The authenticated premium user's active Stripe subscription id.
    pub subscription_id: stripe::SubscriptionId,
}

/// Rejection returned when the premium user check fails.
#[derive(Debug, thiserror::Error)]
pub enum PremiumUserRejection {
    /// The request credentials could not authorize a user.
    #[error("{0}")]
    User(MacroAuthorizationRejection),
    /// The user does not have an active subscription.
    #[error("active subscription required")]
    NotPremium,
    /// The premium check could not be performed.
    #[error(transparent)]
    Service(#[from] TeamError),
}

impl From<MacroAuthorizationRejection> for PremiumUserRejection {
    fn from(rejection: MacroAuthorizationRejection) -> Self {
        Self::User(rejection)
    }
}

impl IntoResponse for PremiumUserRejection {
    fn into_response(self) -> Response {
        match self {
            PremiumUserRejection::User(err) => err.into_response(),
            PremiumUserRejection::NotPremium => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    message: "active subscription required".into(),
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

impl<T, Eas> FromRequestParts<TeamRouterState<T, Eas>> for PremiumUserExtractor
where
    T: TeamService,
    Eas: EntityAccessService,
{
    type Rejection = PremiumUserRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &TeamRouterState<T, Eas>,
    ) -> Result<Self, Self::Rejection> {
        let user = SharedMacroAuthorizationExtractor::from_request_parts(parts, state).await?;

        let Some(subscription_id) = state.service.is_user_premium(&user.macro_user_id).await?
        else {
            return Err(PremiumUserRejection::NotPremium);
        };

        Ok(Self {
            macro_user_id: user.macro_user_id,
            subscription_id,
        })
    }
}
