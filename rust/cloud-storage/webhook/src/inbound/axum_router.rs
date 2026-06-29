//! Axum router for webhook APIs.

use crate::domain::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook, WebhookId,
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
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};
use std::sync::Arc;
use std::time::Duration;

/// State for the webhook router.
pub struct WebhookRouterState<S, R> {
    service: Arc<S>,
    rate_limiter: R,
}

impl<S, R: Clone> Clone for WebhookRouterState<S, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
        }
    }
}

impl<S: WebhookService, R: RateLimitService + Clone> WebhookRouterState<S, R> {
    /// Create webhook router state.
    pub fn new(service: S, rate_limiter: R) -> Self {
        Self {
            service: Arc::new(service),
            rate_limiter,
        }
    }
}

impl<S, R: Clone> FromRef<WebhookRouterState<S, R>> for Arc<S> {
    fn from_ref(state: &WebhookRouterState<S, R>) -> Self {
        state.service.clone()
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
    user: MacroUserExtractor,
    webhook_id: WebhookId,
}

impl<S> RateLimitExtractable<S> for PerUserValidateWebhookRateLimit
where
    S: Send + Sync,
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
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(user): Cached<MacroUserExtractor> = parts
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
            state.rate_limiter.clone(),
            rate_limit_middleware::<R, PerUserValidateWebhookRateLimit, R>,
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
        (status = 201, description = "Webhook created", body = Webhook),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn create_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroUserExtractor,
    Json(request): Json<CreateWebhookRequest>,
) -> Result<(StatusCode, Json<Webhook>), WebhookHandlerError> {
    let webhook = service.create_webhook(user.macro_user_id, request).await?;
    Ok((StatusCode::CREATED, Json(webhook)))
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
pub async fn patch_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroUserExtractor,
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
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn delete_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroUserExtractor,
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
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Webhook not found", body = ErrorResponse),
        (status = 429, description = "Rate limited", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn validate_webhook<S: WebhookService>(
    State(service): State<Arc<S>>,
    user: MacroUserExtractor,
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
