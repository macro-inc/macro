//! Axum router for GTM invite link endpoints.
//!
//! Nested under `/gtm-invite` by the authentication service:
//! - `POST /links` — staff: create a link
//! - `GET /links?mine=true` — staff: list links (all, or just the caller's)
//! - `DELETE /links/{id}` — staff: revoke a link nobody used yet
//! - `GET /public/{token}` — anyone: resolve a link for the welcome page
//! - `POST /redeem` — signed-in user: attribute their account to a link
//! - `GET /offer` — signed-in user: the promotion their account holds

/// Create a link.
pub mod create_link;
/// Wire types shared by the handlers.
pub mod dto;
/// The signed-in user's offer.
pub mod get_offer;
/// Extractor that admits only Macro staff.
pub mod gtm_macro_staff;
/// List links for the dashboard.
pub mod list_links;
/// Attribute the signed-in user to a link.
pub mod redeem_link;
/// Resolve a link for the public welcome page.
pub mod resolve_link;
/// Revoke a link.
pub mod revoke_link;
#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use rate_limit::{RateLimitService, inbound::rate_limit_middleware};

use crate::domain::{models::GtmInviteError, ports::GtmInviteService};
pub use resolve_link::PerIpResolveRateLimit;

impl IntoResponse for GtmInviteError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            GtmInviteError::RateLimitExceeded(_) => StatusCode::TOO_MANY_REQUESTS,
            GtmInviteError::NotFound => StatusCode::NOT_FOUND,
            GtmInviteError::Forbidden => StatusCode::FORBIDDEN,
            GtmInviteError::Expired | GtmInviteError::Revoked => StatusCode::GONE,
            GtmInviteError::AlreadyRedeemed => StatusCode::CONFLICT,
            GtmInviteError::InvalidToken | GtmInviteError::BadRequest(_) => StatusCode::BAD_REQUEST,
            GtmInviteError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
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

/// Router state containing the invite service.
pub struct GtmInviteRouterState<T, R, Auth> {
    /// The invite link service implementation.
    pub service: Arc<T>,
    /// The rate limiter guarding the public resolve endpoint.
    pub rate_limiter: R,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, R: Clone, Auth> Clone for GtmInviteRouterState<T, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, R, Auth> FromRef<GtmInviteRouterState<T, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &GtmInviteRouterState<T, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the invite link router with all endpoints.
pub fn gtm_invite_router<T, R, Auth, S>(state: GtmInviteRouterState<T, R, Auth>) -> Router<S>
where
    T: GtmInviteService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        // The public route is the only unauthenticated one; tokens are
        // unguessable, the per-IP limit just keeps scanners cheap to ignore.
        .route("/public/{token}", get(resolve_link::handler::<T, R, Auth>))
        .layer(axum::middleware::from_fn_with_state(
            state.rate_limiter.clone(),
            rate_limit_middleware::<R, PerIpResolveRateLimit, R>,
        ))
        .route(
            "/links",
            post(create_link::handler::<T, R, Auth>).get(list_links::handler::<T, R, Auth>),
        )
        .route("/links/{id}", delete(revoke_link::handler::<T, R, Auth>))
        .route("/redeem", post(redeem_link::handler::<T, R, Auth>))
        .route("/offer", get(get_offer::handler::<T, R, Auth>))
        .with_state(state)
}
