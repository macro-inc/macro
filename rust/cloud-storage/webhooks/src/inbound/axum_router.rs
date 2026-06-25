//! Axum router and HTTP error mapping for the webhook configuration API.

/// `POST /webhooks` — create a webhook and its rule.
pub mod create_webhook;
/// `PATCH /webhooks/{webhook_id}` — update a webhook and/or its rule.
pub mod patch_webhook;

use std::sync::Arc;

use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{patch, post},
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{
    model::WebhookActor,
    service::{CreateWebhookError, PatchWebhookError, ValidateWebhookError, WebhookService},
};

/// Router state holding the webhook service. The entity-access service is baked
/// into the service implementation, so it does not appear here.
pub struct WebhookRouterState<S> {
    /// The webhook service implementation.
    pub service: Arc<S>,
}

// Manual Clone so `S` need not be `Clone` (it is shared behind an `Arc`).
impl<S> Clone for WebhookRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the webhooks configuration router.
pub fn webhooks_router<S, St>(state: WebhookRouterState<S>) -> Router<St>
where
    S: WebhookService,
    St: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_webhook::handler::<S>))
        .route("/{webhook_id}", patch(patch_webhook::handler::<S>))
        .with_state(state)
}

/// Build the [`WebhookActor`] for a request from its authenticated user context.
///
/// Returns `None` when the user has no organization, since a webhook must be
/// scoped to a workspace (the organization is the V1 tenant boundary).
pub(crate) fn actor_from_user(user: &MacroUserExtractor) -> Option<WebhookActor> {
    let org_id = user.user_context.organization_id?;
    Some(WebhookActor {
        user_id: user.macro_user_id.clone(),
        workspace_id: org_id.to_string(),
        org_id: Some(i64::from(org_id)),
    })
}

/// The message used for any error we don't want to leak details about.
const INTERNAL_MESSAGE: &str = "internal server error";

/// Map a validation error to an HTTP status and a client-safe message.
fn validation_response(error: &ValidateWebhookError) -> (StatusCode, String) {
    match error {
        ValidateWebhookError::ResourceForbidden { .. } => {
            (StatusCode::FORBIDDEN, error.to_string())
        }
        ValidateWebhookError::InvalidEndpoint(_) | ValidateWebhookError::InvalidRule(_) => {
            (StatusCode::BAD_REQUEST, error.to_string())
        }
        ValidateWebhookError::AccessCheck(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            INTERNAL_MESSAGE.to_string(),
        ),
    }
}

fn error_response(status: StatusCode, message: String) -> Response {
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

impl IntoResponse for CreateWebhookError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            CreateWebhookError::Validation(error) => validation_response(&error),
            CreateWebhookError::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            CreateWebhookError::Storage(_)
            | CreateWebhookError::Encryption(_)
            | CreateWebhookError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                INTERNAL_MESSAGE.to_string(),
            ),
        };
        error_response(status, message)
    }
}

impl IntoResponse for PatchWebhookError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            PatchWebhookError::NotFound => (StatusCode::NOT_FOUND, "webhook not found".to_string()),
            PatchWebhookError::Validation(error) => validation_response(&error),
            PatchWebhookError::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            PatchWebhookError::Storage(_)
            | PatchWebhookError::Encryption(_)
            | PatchWebhookError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                INTERNAL_MESSAGE.to_string(),
            ),
        };
        error_response(status, message)
    }
}
