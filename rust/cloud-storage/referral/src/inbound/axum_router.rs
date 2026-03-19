//! Axum router for referral endpoints.
//!
//! Provides routes:
//! - `GET /code` — get the authenticated user's referral code

#[cfg(test)]
mod test;

mod get_referral_code;
mod send_invite;

use std::sync::Arc;

use axum::{Json, Router, http::StatusCode, response::IntoResponse};
use model_error_response::ErrorResponse;

use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;

pub use get_referral_code::*;
pub use send_invite::*;

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

        (status_code, Json(ErrorResponse { message: &message })).into_response()
    }
}

/// Router state containing the referral service.
pub struct ReferralRouterState<T> {
    /// The referral service implementation.
    pub service: Arc<T>,
}

impl<T> Clone for ReferralRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the referral router with all endpoints.
pub fn referral_router<T, S>(state: ReferralRouterState<T>) -> Router<S>
where
    T: ReferralService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/send",
            axum::routing::post(post_referral_invite_handler::<T>),
        )
        .route("/code", axum::routing::get(get_referral_code_handler::<T>))
        .with_state(state)
}
