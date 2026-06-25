//! `PATCH /webhooks/{webhook_id}` — update a webhook and/or replace its rule.

use axum::{
    Json,
    extract::{Path, State},
};
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{
    ids::WebhookId,
    model::{PatchWebhookRequest, Webhook},
    service::{PatchWebhookError, WebhookService},
};

use super::{WebhookRouterState, actor_from_user};

/// Partially update a webhook and/or replace its rule.
///
/// Re-validates anything that changed: a new endpoint URL is re-checked, and a
/// replacement rule is re-validated including resource access. Returns the
/// updated webhook.
#[utoipa::path(
    patch,
    path = "/webhooks/{webhook_id}",
    operation_id = "patch_webhook",
    params(("webhook_id" = String, Path, description = "The webhook id")),
    request_body = PatchWebhookRequest,
    responses(
        (status = 200, body = Webhook),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(webhook_id = %webhook_id), err)]
pub async fn handler<S: WebhookService>(
    State(state): State<WebhookRouterState<S>>,
    user: MacroUserExtractor,
    Path(webhook_id): Path<String>,
    Json(req): Json<PatchWebhookRequest>,
) -> Result<Json<Webhook>, PatchWebhookError> {
    let actor = actor_from_user(&user).ok_or_else(|| {
        PatchWebhookError::BadRequest("user has no organization context".to_string())
    })?;

    let webhook = state
        .service
        .patch_webhook(&actor, &WebhookId::from_string(webhook_id), req)
        .await?;
    Ok(Json(webhook))
}
