//! Axum router for referral endpoints.
//!
//! Provides routes:
//! - `GET /code` — get the authenticated user's referral code

use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;
use axum::{Json, Router, http::StatusCode, response::IntoResponse};
pub use get_referral_code::{__path_get_referral_code_handler, get_referral_code_handler};
use model_error_response::ErrorResponse;
use rate_limit::RateLimitService;
use rate_limit::inbound::rate_limit_middleware;
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
pub struct ReferralRouterState<T, R> {
    /// The referral service implementation.
    pub service: Arc<T>,
    /// the rate limiter service implementation
    pub rate_limiter: R,
}

impl<T, R: Clone> Clone for ReferralRouterState<T, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
        }
    }
}

/// Build the referral router with all endpoints.
pub fn referral_router<T, S, R>(state: ReferralRouterState<T, R>) -> Router<S>
where
    T: ReferralService,
    R: RateLimitService + Clone,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/send",
            axum::routing::post(post_referral_invite_handler::<T, R>),
        )
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn_with_state(
                    state.rate_limiter.clone(),
                    rate_limit_middleware::<R, PerUserReferralRateLimit, R>,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.rate_limiter.clone(),
                    rate_limit_middleware::<R, PerIpReferralRateLimit, R>,
                )),
        )
        .route(
            "/code",
            axum::routing::get(get_referral_code_handler::<T, R>),
        )
        .with_state(state)
}
