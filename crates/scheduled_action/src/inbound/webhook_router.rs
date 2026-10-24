//! A routine's webhook URL: issuing it, and receiving deliveries at it.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use entity_access::domain::models::OwnerAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ScheduledActionAccessExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use serde_json::Value;

use crate::domain::webhooks::{
    IssuedRoutineWebhook, MAX_WEBHOOK_BODY_BYTES, RoutineWebhook, RoutineWebhookDelivery,
    RoutineWebhookError, RoutineWebhooks,
};

#[cfg(test)]
mod test;

pub struct RoutineWebhookRouterState<W, Svc, Auth> {
    pub webhooks: Arc<W>,
    pub access_service: Arc<Svc>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<W, Svc, Auth> Clone for RoutineWebhookRouterState<W, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            webhooks: Arc::clone(&self.webhooks),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<W, Svc, Auth> FromRef<RoutineWebhookRouterState<W, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &RoutineWebhookRouterState<W, Svc, Auth>) -> Self {
        Arc::clone(&state.access_service)
    }
}

impl<W, Svc, Auth> FromRef<RoutineWebhookRouterState<W, Svc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RoutineWebhookRouterState<W, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn routine_webhook_router<W, Svc, Auth, St>(
    state: RoutineWebhookRouterState<W, Svc, Auth>,
) -> Router<St>
where
    W: RoutineWebhooks,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/webhooks/{token}",
            post(deliver::<W, Svc, Auth>).layer(DefaultBodyLimit::max(MAX_WEBHOOK_BODY_BYTES)),
        )
        .route(
            "/scheduled-actions/{id}/webhook",
            get(get_webhook::<W, Svc, Auth>)
                .post(issue_webhook::<W, Svc, Auth>)
                .delete(revoke_webhook::<W, Svc, Auth>),
        )
        .with_state(state)
}

impl IntoResponse for RoutineWebhookError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::NotFound | Self::UnknownToken => StatusCode::NOT_FOUND,
            Self::Internal(error) => {
                tracing::error!(error = %error, "routine webhook request failed");
                return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response();
            }
        };
        (status, self.to_string()).into_response()
    }
}

/// Run the routine this URL belongs to with the JSON body as its event. The
/// token in the path is the only credential.
#[utoipa::path(
    post,
    path = "/scheduled-actions/webhooks/{token}",
    tag = "scheduled actions",
    operation_id = "deliver_scheduled_action_webhook",
    params(("token" = String, Path, description = "The routine's webhook token")),
    request_body(content = Object, description = "Any JSON value, at most 64 KiB"),
    responses(
        (status = 202, body = RoutineWebhookDelivery),
        (status = 400, body = String),
        (status = 404, body = String),
        (status = 413, body = String),
        (status = 500, body = String),
    )
)]
pub async fn deliver<W, Svc, Auth>(
    State(state): State<RoutineWebhookRouterState<W, Svc, Auth>>,
    Path(token): Path<String>,
    body: Bytes,
) -> Result<impl IntoResponse, RoutineWebhookError>
where
    W: RoutineWebhooks,
{
    // Senders label JSON inconsistently, so the body decides, not the header.
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        return Ok((StatusCode::BAD_REQUEST, "the body must be JSON").into_response());
    };
    let delivery = state.webhooks.deliver(&token, payload).await?;
    Ok((StatusCode::ACCEPTED, Json(delivery)).into_response())
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "get_scheduled_action_webhook",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 200, body = RoutineWebhook),
        (status = 401, body = String),
        (status = 404, body = String, description = "No such routine, or it has no webhook URL"),
        (status = 500, body = String),
    )
)]
pub async fn get_webhook<W, Svc, Auth>(
    State(state): State<RoutineWebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<Json<RoutineWebhook>, RoutineWebhookError>
where
    W: RoutineWebhooks,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .webhooks
        .get(entity_access_receipt)
        .await?
        .map(Json)
        .ok_or(RoutineWebhookError::NotFound)
}

/// Issue the routine's webhook URL token, replacing any earlier one. The
/// token is shown only in this response.
#[utoipa::path(
    post,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "issue_scheduled_action_webhook",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 201, body = IssuedRoutineWebhook),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn issue_webhook<W, Svc, Auth>(
    State(state): State<RoutineWebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<impl IntoResponse, RoutineWebhookError>
where
    W: RoutineWebhooks,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let issued = state.webhooks.issue(entity_access_receipt).await?;
    Ok((StatusCode::CREATED, Json(issued)))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "revoke_scheduled_action_webhook",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn revoke_webhook<W, Svc, Auth>(
    State(state): State<RoutineWebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<StatusCode, RoutineWebhookError>
where
    W: RoutineWebhooks,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state.webhooks.revoke(entity_access_receipt).await?;
    Ok(StatusCode::NO_CONTENT)
}
