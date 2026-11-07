//! Axum router for referral endpoints.
//!
//! Provides routes:
//! - `GET /code` — get the authenticated user's referral code

use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;
use axum::{Json, Router, extract::FromRef, http::StatusCode, response::IntoResponse};
pub use get_referral_code::{__path_get_referral_code_handler, get_referral_code_handler};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use rate_limit::inbound::rate_limit_middleware;
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService, domain::models::RateLimitOk,
};
use rootcause::Report;
pub use send_invite::{
    __path_post_referral_invite_handler, PerIpReferralRateLimit, PerUserReferralRateLimit,
    SendInviteBody, post_referral_invite_handler,
};
use std::sync::Arc;
use tower::ServiceBuilder;

mod get_referral_code;
mod send_invite;
#[cfg(test)]
mod test;

impl IntoResponse for ReferralError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            ReferralError::RateLimitExceeded(_) => StatusCode::TOO_MANY_REQUESTS,
            ReferralError::NotFound(_) => StatusCode::NOT_FOUND,
            ReferralError::Unauthorized => StatusCode::UNAUTHORIZED,
            ReferralError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ReferralError::InvalidReferralCode(_) => StatusCode::BAD_REQUEST,
            ReferralError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let mut message = self.to_string();
        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
            // override internal server error to hide errors
            message = "internal server error".to_string();
        }

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Router state containing the referral service.
pub struct ReferralRouterState<T, R, Auth> {
    /// The referral service implementation.
    pub service: Arc<T>,
    /// The rate limiter service implementation.
    pub rate_limiter: R,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, R: Clone, Auth> Clone for ReferralRouterState<T, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, R, Auth> FromRef<ReferralRouterState<T, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ReferralRouterState<T, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

struct ReferralRateLimitState<R, Auth> {
    rate_limiter: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R: Clone, Auth> Clone for ReferralRateLimitState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Auth> FromRef<ReferralRateLimitState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ReferralRateLimitState<R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<R, Auth> RateLimitService for ReferralRateLimitState<R, Auth>
where
    R: RateLimitService,
    Auth: MacroAuthorizationService,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.rate_limiter.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limiter.rollback_ticket(ticket).await
    }
}

/// Build the referral router with all endpoints.
pub fn referral_router<T, S, R, Auth>(state: ReferralRouterState<T, R, Auth>) -> Router<S>
where
    T: ReferralService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let user_rate_limit_state = ReferralRateLimitState {
        rate_limiter: state.rate_limiter.clone(),
        authorization_state: state.authorization_state.clone(),
    };

    Router::new()
        .route(
            "/send",
            axum::routing::post(post_referral_invite_handler::<T, R, Auth>),
        )
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn_with_state(
                    user_rate_limit_state,
                    rate_limit_middleware::<
                        ReferralRateLimitState<R, Auth>,
                        PerUserReferralRateLimit<Auth>,
                        ReferralRateLimitState<R, Auth>,
                    >,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.rate_limiter.clone(),
                    rate_limit_middleware::<R, PerIpReferralRateLimit, R>,
                )),
        )
        .route(
            "/code",
            axum::routing::get(get_referral_code_handler::<T, R, Auth>),
        )
        .with_state(state)
}
