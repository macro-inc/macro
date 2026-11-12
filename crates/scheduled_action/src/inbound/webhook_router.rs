//! Routines' webhook URLs. Managing a routine's URL takes owning the
//! routine; calling one takes only its token, which the URL carries.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, FromRef, Path, State};
use axum::http::{HeaderMap, StatusCode, header::CONTENT_TYPE};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use entity_access::domain::models::OwnerAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ScheduledActionAccessExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::event_trigger::{MAX_WEBHOOK_BODY_BYTES, WebhookBodyError};
use crate::domain::webhooks::{
    CreatedRoutineWebhook, RoutineWebhook, RoutineWebhookError, RoutineWebhooks,
};

#[cfg(test)]
mod test;

pub struct RoutineWebhookRouterState<Webhooks, Access, Auth> {
    pub service: Arc<Webhooks>,
    pub access_service: Arc<Access>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Webhooks, Access, Auth> Clone for RoutineWebhookRouterState<Webhooks, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Webhooks, Access, Auth> FromRef<RoutineWebhookRouterState<Webhooks, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(state: &RoutineWebhookRouterState<Webhooks, Access, Auth>) -> Self {
        Arc::clone(&state.access_service)
    }
}

impl<Webhooks, Access, Auth> FromRef<RoutineWebhookRouterState<Webhooks, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RoutineWebhookRouterState<Webhooks, Access, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn routine_webhook_router<Webhooks, Access, Auth, RouterState>(
    state: RoutineWebhookRouterState<Webhooks, Access, Auth>,
) -> Router<RouterState>
where
    Webhooks: RoutineWebhooks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        // Static segments win over `/{id}`, so this never reads as a routine.
        .route(
            "/scheduled-actions/webhooks/{token}",
            post(deliver::<Webhooks, Access, Auth>)
                .layer(DefaultBodyLimit::max(MAX_WEBHOOK_BODY_BYTES)),
        )
        .route(
            "/scheduled-actions/{id}/webhook",
            post(create::<Webhooks, Access, Auth>)
                .get(get::<Webhooks, Access, Auth>)
                .delete(delete::<Webhooks, Access, Auth>),
        )
        .with_state(state)
}

/// The run a delivery queued.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWebhookDeliveryResponse {
    /// The delivery's event; the run it starts shows in the routine's history.
    pub event_id: Uuid,
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/webhooks/{token}",
    tag = "scheduled actions",
    operation_id = "deliver_routine_webhook",
    params(("token" = String, Path, description = "The secret the routine's webhook URL carries")),
    request_body(content = String, description = "Any UTF-8 text, at most 64 KiB; a JSON body can be matched on", content_type = "text/plain"),
    responses(
        (status = 202, body = RoutineWebhookDeliveryResponse, description = "The routine will run with the body"),
        (status = 400, body = String, description = "The body is not UTF-8 text"),
        (status = 404, body = String, description = "No routine has this URL"),
        (status = 409, body = String, description = "The routine is paused or doesn't run on webhooks"),
        (status = 413, body = String, description = "The body is larger than 64 KiB"),
        (status = 429, body = String, description = "Too many deliveries are waiting to run"),
        (status = 500, body = String),
    )
)]
pub async fn deliver<Webhooks, Access, Auth>(
    State(state): State<RoutineWebhookRouterState<Webhooks, Access, Auth>>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, RoutineWebhookError>
where
    Webhooks: RoutineWebhooks,
{
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let event_id = state.service.deliver(&token, &body, content_type).await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(RoutineWebhookDeliveryResponse {
            event_id: event_id.as_uuid(),
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "create_routine_webhook",
    params(("id" = String, Path, description = "ID of the routine")),
    responses(
        (status = 201, body = CreatedRoutineWebhook, description = "The routine's new URL token, shown only here; any old one stops working"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn create<Webhooks, Access, Auth>(
    State(state): State<RoutineWebhookRouterState<Webhooks, Access, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Access, Auth>,
) -> Result<impl IntoResponse, RoutineWebhookError>
where
    Webhooks: RoutineWebhooks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let created = state.service.create(entity_access_receipt).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "get_routine_webhook",
    params(("id" = String, Path, description = "ID of the routine")),
    responses(
        (status = 200, body = RoutineWebhook),
        (status = 401, body = String),
        (status = 404, body = String, description = "No such routine, or it has no URL"),
        (status = 500, body = String),
    )
)]
pub async fn get<Webhooks, Access, Auth>(
    State(state): State<RoutineWebhookRouterState<Webhooks, Access, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Access, Auth>,
) -> Result<Json<RoutineWebhook>, RoutineWebhookError>
where
    Webhooks: RoutineWebhooks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(state.service.get(entity_access_receipt).await?))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "delete_routine_webhook",
    params(("id" = String, Path, description = "ID of the routine")),
    responses(
        (status = 204, description = "The URL no longer works"),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn delete<Webhooks, Access, Auth>(
    State(state): State<RoutineWebhookRouterState<Webhooks, Access, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Access, Auth>,
) -> Result<StatusCode, RoutineWebhookError>
where
    Webhooks: RoutineWebhooks,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state.service.delete(entity_access_receipt).await?;
    Ok(StatusCode::NO_CONTENT)
}

impl IntoResponse for RoutineWebhookError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::RoutineNotFound | Self::NoWebhook | Self::UnknownUrl => StatusCode::NOT_FOUND,
            Self::Disabled | Self::Body(WebhookBodyError::NotText) => StatusCode::BAD_REQUEST,
            Self::Body(WebhookBodyError::TooLarge) => StatusCode::PAYLOAD_TOO_LARGE,
            Self::NotListening => StatusCode::CONFLICT,
            Self::Backlogged => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal(error) => {
                tracing::error!(error = ?error, "routine webhook failed");
                return (StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
                    .into_response();
            }
        };
        (status, self.to_string()).into_response()
    }
}
