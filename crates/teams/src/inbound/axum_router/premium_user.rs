//! Extractor that ensures the authenticated user is a premium user.

use std::marker::PhantomData;

use axum::{
    Json,
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;

use crate::domain::{model::TeamError, team_repo::TeamService};

use super::TeamRouterState;

/// Extractor that ensures the authenticated user is a premium user
/// (has an active stripe subscription).
pub struct PremiumUserExtractor<Auth> {
    /// The authenticated premium user's id.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The authenticated premium user's active Stripe subscription id.
    pub subscription_id: stripe::SubscriptionId,
    _authorization: PhantomData<fn() -> Auth>,
}

/// Rejection returned when the premium user check fails.
#[derive(Debug, thiserror::Error)]
pub enum PremiumUserRejection {
    /// The request could not be authorized.
    #[error("authorization failed")]
    Authorization(MacroAuthorizationRejection),
    /// The user does not have an active subscription.
    #[error("active subscription required")]
    NotPremium,
    /// The premium check could not be performed.
    #[error(transparent)]
    Service(#[from] TeamError),
}

impl IntoResponse for PremiumUserRejection {
    fn into_response(self) -> Response {
        match self {
            PremiumUserRejection::Authorization(rejection) => rejection.into_response(),
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

impl From<MacroAuthorizationRejection> for PremiumUserRejection {
    fn from(rejection: MacroAuthorizationRejection) -> Self {
        Self::Authorization(rejection)
    }
}

impl<T, Eas, Auth> FromRequestParts<TeamRouterState<T, Eas, Auth>> for PremiumUserExtractor<Auth>
where
    T: TeamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = PremiumUserRejection;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &TeamRouterState<T, Eas, Auth>,
    ) -> Result<Self, Self::Rejection> {
        let user = MacroAuthorizationExtractor::<Auth>::from_request_parts(parts, state).await?;

        let Some(subscription_id) = state.service.is_user_premium(&user.macro_user_id).await?
        else {
            return Err(PremiumUserRejection::NotPremium);
        };

        Ok(Self {
            macro_user_id: user.macro_user_id,
            subscription_id,
            _authorization: PhantomData,
        })
    }
}
