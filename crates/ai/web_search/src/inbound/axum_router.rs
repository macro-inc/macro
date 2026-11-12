//! HTTP adapter: `POST /web/search` and `POST /web/fetch` for any caller with a
//! verified acting user (signed-in users, API keys, and code-mode SDK tokens).

use std::{sync::Arc, time::Duration};

use ai_billing::inbound::admission::admission_status;
use axum::{
    Json, RequestPartsExt, Router,
    extract::{FromRef, FromRequestParts, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use axum_extra::extract::Cached;
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService,
    domain::models::RateLimitOk,
    inbound::{RateLimitExtractable, RateLimitExtractor},
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::models::{
    WebFetch, WebFetchResponse, WebSearch, WebSearchError, WebSearchResponse,
};
use crate::domain::service::{WebCaller, WebSearchService};

#[cfg(test)]
mod test;

/// Searches and fetches each user may make per hour, counted together.
const PER_USER_REQUESTS_PER_HOUR: u64 = 600;

/// Router state: the use case, a rate limiter, and caller authentication.
pub struct WebRouterState<R, Auth> {
    service: Arc<WebSearchService>,
    rate_limiter: R,
    authorization: MacroAuthorizationState<Auth>,
}

impl<R: Clone, Auth> Clone for WebRouterState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<R, Auth> WebRouterState<R, Auth> {
    /// Compose the use case with the host's rate limiter and authorization.
    pub fn new(
        service: Arc<WebSearchService>,
        rate_limiter: R,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            rate_limiter,
            authorization,
        }
    }
}

impl<R, Auth> FromRef<WebRouterState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &WebRouterState<R, Auth>) -> Self {
        state.authorization.clone()
    }
}

impl<R, Auth> RateLimitService for WebRouterState<R, Auth>
where
    R: RateLimitService,
    Auth: MacroAuthorizationService,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let result = self.rate_limiter.check_rate_limit(key, config).await?;
        if result.is_err() {
            tracing::warn!("web search rate limit exceeded");
        }
        Ok(result)
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limiter.rollback_ticket(ticket).await
    }
}

/// Per-user web request limit, keyed by the verified acting user.
pub struct PerUserWebRateLimit<Auth>(MacroAuthorizationExtractor<Auth, ActingUser>);

impl<S, Auth> RateLimitExtractable<S> for PerUserWebRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig::new(PER_USER_REQUESTS_PER_HOUR, Duration::from_secs(3600))
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-web-search")
            .append(&self.0.authorization.user.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserWebRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, ActingUser>> = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;
        Ok(Self(authorization))
    }
}

/// `POST /web/search` and `POST /web/fetch`.
pub fn web_router<R, Auth, S>(state: WebRouterState<R, Auth>) -> Router<S>
where
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/web/search", post(search_handler::<R, Auth>))
        .route("/web/fetch", post(fetch_handler::<R, Auth>))
        .with_state(state)
}

/// Machine-readable failure of a web request.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WebErrorBody {
    /// Explanation without provider diagnostics.
    pub error: String,
    /// Stable failure code.
    pub code: String,
}

/// An HTTP status with its [`WebErrorBody`].
pub struct WebFailure {
    status: StatusCode,
    body: WebErrorBody,
}

impl From<WebSearchError> for WebFailure {
    fn from(error: WebSearchError) -> Self {
        let status = match &error {
            WebSearchError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            WebSearchError::Admission(admission) => admission_status(*admission),
            // A deployment without the provider key is missing a feature, not
            // failing: a 5xx here would page on every call.
            WebSearchError::NotConfigured(_) => StatusCode::NOT_FOUND,
            WebSearchError::Throttled => StatusCode::SERVICE_UNAVAILABLE,
            WebSearchError::PageUnavailable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            WebSearchError::Provider(_) => StatusCode::BAD_GATEWAY,
        };
        if status.is_server_error() {
            tracing::error!(error = ?error, code = error.code(), "web request failed");
        } else if matches!(error, WebSearchError::NotConfigured(_)) {
            tracing::warn!(
                code = error.code(),
                "web request refused: provider not configured"
            );
        }
        Self {
            status,
            body: WebErrorBody {
                error: error.to_string(),
                code: error.code().to_owned(),
            },
        }
    }
}

impl IntoResponse for WebFailure {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

fn invalid_body(rejection: JsonRejection) -> WebFailure {
    WebFailure {
        status: StatusCode::BAD_REQUEST,
        body: WebErrorBody {
            error: rejection.body_text(),
            code: "invalid_request".to_owned(),
        },
    }
}

/// Search the public web. Charged to the acting user's AI allowance.
#[utoipa::path(
    post,
    path = "/web/search",
    operation_id = "search_web",
    tag = "web",
    request_body = WebSearch,
    responses(
        (status = 200, description = "Results, best match first", body = WebSearchResponse),
        (status = 400, description = "Invalid query or filters", body = WebErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "AI allowance exhausted", body = WebErrorBody),
        (status = 404, description = "Web search is not configured in this deployment", body = WebErrorBody),
        (status = 429, description = "Per-user hourly rate limit exceeded"),
        (status = 502, description = "The search provider failed", body = WebErrorBody),
        (status = 503, description = "Web search busy, or usage validation unavailable", body = WebErrorBody),
    )
)]
pub async fn search_handler<R, Auth>(
    Cached(caller): Cached<MacroAuthorizationExtractor<Auth, ActingUser>>,
    _limit: RateLimitExtractor<PerUserWebRateLimit<Auth>, WebRouterState<R, Auth>>,
    State(state): State<WebRouterState<R, Auth>>,
    request: Result<Json<WebSearch>, JsonRejection>,
) -> Result<Json<WebSearchResponse>, WebFailure>
where
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
{
    let Json(request) = request.map_err(invalid_body)?;
    let response = state
        .service
        .search(
            WebCaller::user(caller.authorization.user.macro_user_id),
            request,
        )
        .await?;
    Ok(Json(response))
}

/// Read one public web page as Markdown. Charged to the acting user's AI allowance.
#[utoipa::path(
    post,
    path = "/web/fetch",
    operation_id = "fetch_web_page",
    tag = "web",
    request_body = WebFetch,
    responses(
        (status = 200, description = "The page text", body = WebFetchResponse),
        (status = 400, description = "Invalid URL or length", body = WebErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "AI allowance exhausted", body = WebErrorBody),
        (status = 404, description = "Web fetch is not configured in this deployment", body = WebErrorBody),
        (status = 422, description = "The page could not be read", body = WebErrorBody),
        (status = 429, description = "Per-user hourly rate limit exceeded"),
        (status = 502, description = "The fetch provider failed", body = WebErrorBody),
        (status = 503, description = "Web fetch busy, or usage validation unavailable", body = WebErrorBody),
    )
)]
pub async fn fetch_handler<R, Auth>(
    Cached(caller): Cached<MacroAuthorizationExtractor<Auth, ActingUser>>,
    _limit: RateLimitExtractor<PerUserWebRateLimit<Auth>, WebRouterState<R, Auth>>,
    State(state): State<WebRouterState<R, Auth>>,
    request: Result<Json<WebFetch>, JsonRejection>,
) -> Result<Json<WebFetchResponse>, WebFailure>
where
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
{
    let Json(request) = request.map_err(invalid_body)?;
    let response = state
        .service
        .fetch(
            WebCaller::user(caller.authorization.user.macro_user_id),
            request,
        )
        .await?;
    Ok(Json(response))
}
