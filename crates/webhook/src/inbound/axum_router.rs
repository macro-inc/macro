//! Axum router for webhook APIs.

use crate::domain::{
    models::{
        CreateWebhookRequest, CreateWebhookResponse, PatchWebhookRequest, ValidateWebhookResponse,
        Webhook, WebhookId,
    },
    ports::{WebhookError, WebhookService},
};
use axum::{
    Json, RequestPartsExt, Router,
    extract::{FromRef, FromRequestParts, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{patch, post},
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService};
use rootcause::Report;
use std::sync::Arc;
use std::time::Duration;

/// State for the webhook router.
pub struct WebhookRouterState<S, R, Auth> {
    service: Arc<S>,
    rate_limiter: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, R: Clone, Auth> Clone for WebhookRouterState<S, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: WebhookService, R: RateLimitService + Clone, Auth> WebhookRouterState<S, R, Auth> {
    /// Create webhook router state.
    pub fn new(
        service: S,
        rate_limiter: R,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            rate_limiter,
            authorization_state,
        }
    }
}

impl<S, R, Auth> FromRef<WebhookRouterState<S, R, Auth>> for Arc<S> {
    fn from_ref(state: &WebhookRouterState<S, R, Auth>) -> Self {
        state.service.clone()
    }
}

impl<S, R, Auth> FromRef<WebhookRouterState<S, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &WebhookRouterState<S, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Webhook path parameters.
#[derive(Debug, serde::Deserialize)]
pub struct WebhookPath {
    /// Webhook id.
    pub webhook_id: WebhookId,
}

/// Per-user validation attempt rate limit.
pub struct PerUserValidateWebhookRateLimit<Auth> {
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    webhook_id: WebhookId,
}

impl<S, Auth> RateLimitExtractable<S> for PerUserValidateWebhookRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 10,
            window: Duration::from_secs(3600),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-validate-webhook")
            .append(&self.authorization.authorization.user.macro_user_id.as_ref())
            .append(&self.webhook_id)
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserValidateWebhookRateLimit<Auth>
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
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>> =
            parts
                .extract_with_state(state)
                .await
                .map_err(IntoResponse::into_response)?;
        let Path(path): Path<WebhookPath> = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;

        Ok(Self {
            authorization,
            webhook_id: path.webhook_id,
        })
    }
}

struct ValidateWebhookRateLimitState<R, Auth> {
    rate_limiter: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R: Clone, Auth> Clone for ValidateWebhookRateLimitState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Auth> FromRef<ValidateWebhookRateLimitState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ValidateWebhookRateLimitState<R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<R, Auth> RateLimitService for ValidateWebhookRateLimitState<R, Auth>
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

/// Create a webhook API router.
pub fn webhook_router<S, R, Auth, T>(state: WebhookRouterState<S, R, Auth>) -> Router<T>
where
    S: WebhookService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    let rate_limit_state = ValidateWebhookRateLimitState {
        rate_limiter: state.rate_limiter.clone(),
        authorization_state: state.authorization_state.clone(),
    };
    let validate_route = Router::new()
        .route(
            "/webhooks/{webhook_id}/validate",
            post(validate_webhook::<S, Auth>),
        )
        .layer(axum::middleware::from_fn_with_state(
            rate_limit_state,
            rate_limit_middleware::<
                ValidateWebhookRateLimitState<R, Auth>,
                PerUserValidateWebhookRateLimit<Auth>,
                ValidateWebhookRateLimitState<R, Auth>,
            >,
        ));

    Router::new()
        .route("/webhooks", post(create_webhook::<S, Auth>))
        .route(
            "/webhooks/{webhook_id}",
            patch(patch_webhook::<S, Auth>).delete(delete_webhook::<S, Auth>),
        )
        .merge(validate_route)
        .with_state(state)
}

/// Create a webhook.
#[utoipa::path(
    post,
    path = "/webhook/webhooks",
    request_body = CreateWebhookRequest,
    responses(
        (status = 201, description = "Webhook created", body = CreateWebhookResponse),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn create_webhook<S: WebhookService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CreateWebhookRequest>,
) -> Result<(StatusCode, Json<CreateWebhookResponse>), WebhookHandlerError> {
    let webhook = service
        .create_webhook(authorization.authorization.user.macro_user_id, request)
        .await?;
    Ok((StatusCode::CREATED, Json(webhook.into())))
}

/// Patch a webhook.
#[utoipa::path(
    patch,
    path = "/webhook/webhooks/{webhook_id}",
    params(("webhook_id" = String, Path, description = "Webhook id")),
    request_body = PatchWebhookRequest,
    responses(
        (status = 200, description = "Webhook updated", body = Webhook),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn patch_webhook<S: WebhookService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<WebhookPath>,
    Json(request): Json<PatchWebhookRequest>,
) -> Result<Json<Webhook>, WebhookHandlerError> {
    Ok(Json(
        service
            .patch_webhook(
                authorization.authorization.user.macro_user_id,
                path.webhook_id,
                request,
            )
            .await?,
    ))
}

/// Delete a webhook.
#[utoipa::path(
    delete,
    path = "/webhook/webhooks/{webhook_id}",
    params(("webhook_id" = String, Path, description = "Webhook id")),
    responses(
        (status = 204, description = "Webhook deleted"),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn delete_webhook<S: WebhookService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<WebhookPath>,
) -> Result<StatusCode, WebhookHandlerError> {
    service
        .delete_webhook(
            authorization.authorization.user.macro_user_id,
            path.webhook_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Validate a webhook endpoint.
#[utoipa::path(
    post,
    path = "/webhook/webhooks/{webhook_id}/validate",
    params(("webhook_id" = String, Path, description = "Webhook id")),
    responses(
        (status = 200, description = "Webhook validation result", body = ValidateWebhookResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 429, description = "Rate limited", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn validate_webhook<S: WebhookService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(path): Path<WebhookPath>,
) -> Result<Json<ValidateWebhookResponse>, WebhookHandlerError> {
    Ok(Json(
        service
            .validate_webhook(
                authorization.authorization.user.macro_user_id,
                path.webhook_id,
            )
            .await?,
    ))
}

/// Webhook handler error.
pub struct WebhookHandlerError(WebhookError);

impl From<WebhookError> for WebhookHandlerError {
    fn from(error: WebhookError) -> Self {
        Self(error)
    }
}

impl IntoResponse for WebhookHandlerError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            WebhookError::BadRequest(_) => StatusCode::BAD_REQUEST,
            WebhookError::Unauthorized => StatusCode::FORBIDDEN,
            WebhookError::NotFound(_) => StatusCode::NOT_FOUND,
            WebhookError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self.0, "webhook handler error");
            "internal server error".to_string()
        } else {
            self.0.to_string()
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
