//! Handler for `GET /gtm-invite/public/{token}`.

use std::time::Duration;

use axum::{
    Json, RequestPartsExt,
    extract::{FromRequestParts, Path, State},
};
use chrono::Utc;
use ip_extractor::ClientIp;
use macro_authorization::MacroAuthorizationService;
use rate_limit::{RateLimitConfig, RateLimitKey, inbound::RateLimitExtractable};

use super::GtmInviteRouterState;
use super::dto::PublicGtmInviteLink;
use crate::domain::models::{GtmInviteError, InviteToken};
use crate::domain::ports::GtmInviteService;

/// Resolves an invite link for the public welcome page and counts the open.
///
/// Unauthenticated: the recipient has no account yet. Only the first name and
/// whether the link is still usable are exposed.
#[utoipa::path(
    tag = "gtm_invite",
    get,
    path = "/gtm-invite/public/{token}",
    operation_id = "resolve_gtm_invite_link",
    params(("token" = String, Path, description = "The token from the invite link URL")),
    responses(
        (status = 200, body = PublicGtmInviteLink),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 429),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    Path(token): Path<String>,
) -> Result<Json<PublicGtmInviteLink>, GtmInviteError> {
    let token: InviteToken = token.parse()?;
    let link = state.service.resolve_link(&token).await?;

    Ok(Json(PublicGtmInviteLink {
        first_name: link.first_name.clone(),
        status: link.status(Utc::now()).into(),
        free_months: state.service.config().free_months,
    }))
}

/// Per-IP rate limit on resolving links: generous for a person reloading a
/// welcome page, tight enough that scanning tokens is pointless.
pub struct PerIpResolveRateLimit(ClientIp);

impl<S> RateLimitExtractable<S> for PerIpResolveRateLimit
where
    S: Send + Sync,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 120,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-ip-gtm-invite-resolve")
            .append(&self.0.origin_ip())
            .finish()
    }
}

impl<S> FromRequestParts<S> for PerIpResolveRateLimit
where
    S: Send + Sync,
{
    type Rejection = <ClientIp as FromRequestParts<S>>::Rejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let ip: ClientIp = parts.extract_with_state(state).await?;
        Ok(Self(ip))
    }
}
