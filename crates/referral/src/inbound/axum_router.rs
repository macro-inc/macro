//! Axum router for referral endpoints.
//!
//! Provides routes:
//! - `GET /code` — get the authenticated user's referral code

use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;
use axum::{Json, Router, extract::FromRef, http::StatusCode, response::IntoResponse};
pub use get_referral_code::{__path_get_referral_code_handler, get_referral_code_handler};
use macro_authorization::MacroAuthorizationServiceHandle;
use model_error_response::ErrorResponse;
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService, domain::models::RateLimitOk,
    inbound::rate_limit_middleware,
};
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
    /// The rate limiter service implementation.
    pub rate_limiter: R,
    /// The authorization service used to authenticate callers.
    pub authorization: MacroAuthorizationServiceHandle,
}

impl<T, R: Clone> Clone for ReferralRouterState<T, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<T, R> FromRef<ReferralRouterState<T, R>> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &ReferralRouterState<T, R>) -> Self {
        state.authorization.clone()
    }
}

// A nominal wrapper avoids overlapping `FromRef` implementations when the
// generic rate limiter is itself an authorization service handle.
#[derive(Clone)]
struct ReferralRateLimiter<R>(R);

impl<T, R: Clone> FromRef<ReferralRouterState<T, R>> for ReferralRateLimiter<R> {
    fn from_ref(state: &ReferralRouterState<T, R>) -> Self {
        Self(state.rate_limiter.clone())
    }
}

impl<R: RateLimitService> RateLimitService for ReferralRateLimiter<R> {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, rootcause::Report> {
        self.0.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), rootcause::Report> {
        self.0.rollback_ticket(ticket).await
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
                    state.clone(),
                    rate_limit_middleware::<
                        ReferralRouterState<T, R>,
                        PerUserReferralRateLimit,
                        ReferralRateLimiter<R>,
                    >,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    rate_limit_middleware::<
                        ReferralRouterState<T, R>,
                        PerIpReferralRateLimit,
                        ReferralRateLimiter<R>,
                    >,
                )),
        )
        .route(
            "/code",
            axum::routing::get(get_referral_code_handler::<T, R>),
        )
        .with_state(state)
}
