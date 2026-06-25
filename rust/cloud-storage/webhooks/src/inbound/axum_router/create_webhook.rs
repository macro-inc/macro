//! `POST /webhooks` — create a webhook together with its rule.

use axum::{Json, extract::State};
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{
    model::{CreateWebhookRequest, CreateWebhookResponse},
    service::{CreateWebhookError, WebhookService},
};

use super::{WebhookRouterState, actor_from_user};

/// Create a webhook and its single rule.
///
/// Validates the endpoint URL and the rule (including that the caller has
/// access to every resource the rule filters on) before persisting. The
/// response includes the generated signing secret, which is shown only here.
#[utoipa::path(
    post,
    path = "/webhooks",
    operation_id = "create_webhook",
    request_body = CreateWebhookRequest,
    responses(
        (status = 200, body = CreateWebhookResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<S: WebhookService>(
    State(state): State<WebhookRouterState<S>>,
    user: MacroUserExtractor,
    Json(req): Json<CreateWebhookRequest>,
) -> Result<Json<CreateWebhookResponse>, CreateWebhookError> {
    let actor = actor_from_user(&user).ok_or_else(|| {
        CreateWebhookError::BadRequest("user has no organization context".to_string())
    })?;

    let response = state.service.create_webhook(&actor, req).await?;
    Ok(Json(response))
}
