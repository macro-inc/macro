//! Handler for `POST /send`.

use axum::RequestPartsExt;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::StatusCode;
use axum::{Json, extract::State};
use axum_extra::extract::Cached;
use ip_extractor::ClientIp;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::email::EmailStr;
use rate_limit::inbound::RateLimitExtractable;
use rate_limit::{RateLimitConfig, RateLimitKey};
use serde::Deserialize;
use std::time::Duration;

use super::ReferralRouterState;
use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;

/// The body which is used to describe the recipient email
#[derive(Deserialize, utoipa::ToSchema)]
pub struct SendInviteBody {
    /// the recipient of the referral email
    #[schema(value_type = String)]
    recipient: EmailStr<'static>,
}

/// Handler for `POST /referral/send`.
///
/// Sends a referral code via email to a user
#[utoipa::path(
    tag = "referral",
    post,
    path = "/referral/send",
    operation_id = "send_referral_code",
    responses(
        (status = StatusCode::NO_CONTENT),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, authorization), err)]
pub async fn post_referral_invite_handler<
    T: ReferralService,
    R,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ReferralRouterState<T, R, Auth>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(SendInviteBody { recipient }): Json<SendInviteBody>,
) -> Result<StatusCode, ReferralError> {
    let user = authorization.authorization.user;
    let () = state
        .service
        .send_referral_invite(user.macro_user_id.clone(), recipient)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// the rate limit definition for the per-user rate limit on referring new users
pub struct PerUserReferralRateLimit<Auth>(MacroAuthorizationExtractor<Auth, UserOrInternal>);

impl<S, Auth> RateLimitExtractable<S> for PerUserReferralRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> rate_limit::RateLimitConfig {
        // The fixed window rate limit config for the number of invites a user can send to others
        RateLimitConfig {
            max_count: 50,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> rate_limit::RateLimitKey {
        RateLimitKey::builder(&"per-user-referral")
            .append(&self.0.authorization.user.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserReferralRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>> =
            parts.extract_with_state(state).await?;
        Ok(Self(authorization))
    }
}

/// The struct which impl [RateLimitExtractable] to limit the number of per-ip requests
/// for the send invite route
pub struct PerIpReferralRateLimit(ClientIp);

impl<S> RateLimitExtractable<S> for PerIpReferralRateLimit
where
    S: Send + Sync,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 50,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-ip-referral")
            .append(&self.0.origin_ip())
            .finish()
    }
}

impl<S> FromRequestParts<S> for PerIpReferralRateLimit
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
