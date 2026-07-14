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
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationServiceImpl};
use model_error_response::ErrorResponse;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService};
use std::sync::Arc;
use std::time::Duration;

/// State for the webhook router.
pub struct WebhookRouterState<S, R> {
    service: Arc<S>,
    rate_limiter: R,
    authorization_service: MacroAuthorizationServiceImpl,
}

impl<S, R: Clone> Clone for WebhookRouterState<S, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization_service: self.authorization_service.clone(),
        }
    }
}

impl<S: WebhookService, R: RateLimitService + Clone> WebhookRouterState<S, R> {
    /// Create webhook router state.
    pub fn new(
        service: S,
        rate_limiter: R,
        authorization_service: MacroAuthorizationServiceImpl,
    ) -> Self {
        Self {
            service: Arc::new(service),
            rate_limiter,
            authorization_service,
        }
    }
}

impl<S, R: Clone> FromRef<WebhookRouterState<S, R>> for Arc<S> {
    fn from_ref(state: &WebhookRouterState<S, R>) -> Self {
        state.service.clone()
    }
}

impl<S, R> FromRef<WebhookRouterState<S, R>> for MacroAuthorizationServiceImpl {
    fn from_ref(state: &WebhookRouterState<S, R>) -> Self {
        state.authorization_service.clone()
    }
}

// A nominal wrapper avoids overlapping `FromRef` implementations when the
// webhook service and rate limiter are both generic.
#[derive(Clone)]
struct WebhookRateLimiter<R>(R);

impl<S, R: Clone> FromRef<WebhookRouterState<S, R>> for WebhookRateLimiter<R> {
    fn from_ref(state: &WebhookRouterState<S, R>) -> Self {
        Self(state.rate_limiter.clone())
    }
}

impl<R: RateLimitService> RateLimitService for WebhookRateLimiter<R> {
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

/// Webhook path parameters.
#[derive(Debug, serde::Deserialize)]
pub struct WebhookPath {
    /// Webhook id.
    pub webhook_id: WebhookId,
}

/// Per-user validation attempt rate limit.
pub struct PerUserValidateWebhookRateLimit {
    user: MacroAuthorizationExtractor,
    webhook_id: WebhookId,
}

impl<S> RateLimitExtractable<S> for PerUserValidateWebhookRateLimit
where
    MacroAuthorizationServiceImpl: FromRef<S>,
    S: Send + Sync + 'static,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 10,
            window: Duration::from_secs(3600),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-validate-webhook")
            .append(&self.user.macro_user_id.as_ref())
            .append(&self.webhook_id)
            .finish()
    }
}

impl<S> FromRequestParts<S> for PerUserValidateWebhookRateLimit
where
    MacroAuthorizationServiceImpl: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let user = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;
        let Path(path): Path<WebhookPath> = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;

        Ok(Self {
            user,
            webhook_id: path.webhook_id,
        })
    }
}

/// Create a webhook API router.
pub fn webhook_router<S, R, T>(state: WebhookRouterState<S, R>) -> Router<T>
where
    S: WebhookService,
    R: RateLimitService + Clone,
    T: Send + Sync,
{
    let validate_route = Router::new()
        .route(
            "/webhooks/{webhook_id}/validate",
            post(validate_webhook::<S>),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware::<
                WebhookRouterState<S, R>,
                PerUserValidateWebhookRateLimit,
                WebhookRateLimiter<R>,
            >,
        ));

    Router::new()
        .route("/webhooks", post(create_webhook::<S>))
        .route(
            "/webhooks/{webhook_id}",
            patch(patch_webhook::<S>).delete(delete_webhook::<S>),
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
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn create_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
    Json(request): Json<CreateWebhookRequest>,
) -> Result<(StatusCode, Json<CreateWebhookResponse>), WebhookHandlerError> {
    let webhook = service.create_webhook(user.macro_user_id, request).await?;
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
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn patch_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
    Path(path): Path<WebhookPath>,
    Json(request): Json<PatchWebhookRequest>,
) -> Result<Json<Webhook>, WebhookHandlerError> {
    Ok(Json(
        service
            .patch_webhook(user.macro_user_id, path.webhook_id, request)
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
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn delete_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
    Path(path): Path<WebhookPath>,
) -> Result<StatusCode, WebhookHandlerError> {
    service
        .delete_webhook(user.macro_user_id, path.webhook_id)
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
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 429, description = "Rate limited", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn validate_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroAuthorizationExtractor,
    Path(path): Path<WebhookPath>,
) -> Result<Json<ValidateWebhookResponse>, WebhookHandlerError> {
    Ok(Json(
        service
            .validate_webhook(user.macro_user_id, path.webhook_id)
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
