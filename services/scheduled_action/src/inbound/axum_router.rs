use std::sync::Arc;

use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{
    ActionExecutionRecord, ActionPolicyError, AlreadyRunningError, CreateScheduledAction,
    InProgressExecution, OwnerNotUserError, Schedule, ScheduledAction, UpdateScheduledAction,
};
use crate::domain::ports::ScheduledActionService;
use axum::extract::{FromRef, Path, Query, State, rejection::JsonRejection};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono_tz::Tz;
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model::response::EmptyResponse;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[cfg(test)]
mod test;

/// Canonical trigger plus deprecated cron fields for existing clients. Event
/// responses omit legacy fields rather than inventing a schedule or timezone.
#[derive(Debug, Serialize, ToSchema)]
pub struct ScheduledActionResponse {
    #[serde(flatten)]
    pub action: ScheduledAction,
    /// Deprecated: use `trigger.schedule`. Present only for cron actions.
    #[deprecated(note = "use trigger.schedule")]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub schedule: Option<Schedule>,
    /// Deprecated: use `trigger.timezone`. Present only for cron actions.
    #[deprecated(note = "use trigger.timezone")]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub timezone: Option<Tz>,
}

impl From<ScheduledAction> for ScheduledActionResponse {
    #[expect(deprecated, reason = "compatibility response populates legacy fields")]
    fn from(action: ScheduledAction) -> Self {
        let (schedule, timezone) = match &action.trigger {
            ActionTrigger::Cron { schedule, timezone } => (Some(schedule.clone()), Some(*timezone)),
            ActionTrigger::Events { .. } => (None, None),
        };
        Self {
            action,
            schedule,
            timezone,
        }
    }
}

#[derive(Debug, Default, Deserialize, IntoParams)]
pub struct ListActionsQuery {
    /// Backend clients must opt in to event actions; defaults to false (cron-only).
    #[param(default = false)]
    pub include_events: Option<bool>,
}

pub struct ScheduledActionRouterState<S, Auth> {
    pub service: Arc<S>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for ScheduledActionRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<ScheduledActionRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ScheduledActionRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn scheduled_action_router<S, Auth, St>(
    state: ScheduledActionRouterState<S, Auth>,
) -> Router<St>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/user/{user_id}",
            delete(delete_user_actions::<S, Auth>),
        )
        .route(
            "/scheduled-actions",
            get(list_actions::<S, Auth>).post(create_action::<S, Auth>),
        )
        .route(
            "/scheduled-actions/{id}",
            put(update_action::<S, Auth>).delete(delete_action::<S, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/execute",
            post(execute_action::<S, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/history",
            get(list_history::<S, Auth>),
        )
        .with_state(state)
}

async fn delete_user_actions<S: ScheduledActionService, Auth: MacroAuthorizationService>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(user_id): Path<MacroUserIdStr<'static>>,
) -> Result<StatusCode, ScheduledActionApiError> {
    state.service.delete_user_actions(user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/health",
    tag = "scheduled actions",
    operation_id = "scheduled_action_health",
    responses(
        (status = 200, description = "health", body = EmptyResponse),
    )
)]
pub async fn health() -> impl IntoResponse {
    Json(EmptyResponse::default())
}

#[utoipa::path(
    post,
    path = "/scheduled-actions",
    tag = "scheduled actions",
    operation_id = "create_scheduled_action",
    request_body = CreateScheduledAction,
    responses(
        (status = 201, body = ScheduledActionResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
pub async fn create_action<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    body: Result<Json<CreateScheduledAction>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let created = state
        .service
        .create_action(req, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(ScheduledActionResponse::from(created)),
    ))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions",
    tag = "scheduled actions",
    operation_id = "list_scheduled_actions",
    params(ListActionsQuery),
    responses(
        (status = 200, body = Vec<ScheduledActionResponse>),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
pub async fn list_actions<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<ListActionsQuery>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let actions = state
        .service
        .get_actions(
            user.authorization.user.macro_user_id.clone(),
            query.include_events.unwrap_or(false),
        )
        .await?;
    Ok(Json(
        actions
            .into_iter()
            .map(ScheduledActionResponse::from)
            .collect::<Vec<_>>(),
    ))
}

#[utoipa::path(
    put,
    path = "/scheduled-actions/{id}",
    tag = "scheduled actions",
    operation_id = "update_scheduled_action",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    request_body = UpdateScheduledAction,
    responses(
        (status = 200, body = ScheduledActionResponse),
        (status = 400, body = String),
        (status = 409, body = String, description = "Configuration changed or execution is active"),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn update_action<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
    body: Result<Json<UpdateScheduledAction>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let updated = state
        .service
        .update_action(&id, req, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(ScheduledActionResponse::from(updated)))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/{id}",
    tag = "scheduled actions",
    operation_id = "delete_scheduled_action",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn delete_action<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    state
        .service
        .delete_action(&id, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/{id}/execute",
    tag = "scheduled actions",
    operation_id = "execute_scheduled_action_now",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 200, body = InProgressExecution),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 409, body = String, description = "Action is already running"),
        (status = 500, body = String),
    )
)]
pub async fn execute_action<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let execution = state
        .service
        .execute_action_now(&id, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(execution))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/history",
    tag = "scheduled actions",
    operation_id = "list_scheduled_action_history",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 200, body = Vec<ActionExecutionRecord>),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn list_history<
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ScheduledActionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let records = state
        .service
        .get_execution_records(&id, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(records))
}

pub enum ScheduledActionApiError {
    InvalidRequest(JsonRejection),
    Service(anyhow::Error),
}

impl From<anyhow::Error> for ScheduledActionApiError {
    fn from(err: anyhow::Error) -> Self {
        Self::Service(err)
    }
}

impl IntoResponse for ScheduledActionApiError {
    fn into_response(self) -> axum::response::Response {
        let error = match self {
            Self::InvalidRequest(rejection) => {
                let status = if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                    StatusCode::PAYLOAD_TOO_LARGE
                } else {
                    StatusCode::BAD_REQUEST
                };
                return (status, "invalid scheduled action request").into_response();
            }
            Self::Service(error) => error,
        };
        if let Some(policy) = error.downcast_ref::<ActionPolicyError>() {
            let status = match policy {
                ActionPolicyError::NotFound => StatusCode::NOT_FOUND,
                ActionPolicyError::UpdateConflict => StatusCode::CONFLICT,
                ActionPolicyError::NoFutureFirings | ActionPolicyError::EventManagementDisabled => {
                    StatusCode::BAD_REQUEST
                }
            };
            return (status, policy.to_string()).into_response();
        }
        if let Some(already_running) = error.downcast_ref::<AlreadyRunningError>() {
            tracing::info!(error=%already_running, "scheduled action already running");
            return (StatusCode::CONFLICT, already_running.to_string()).into_response();
        }
        if let Some(owner_not_user) = error.downcast_ref::<OwnerNotUserError>() {
            tracing::warn!(error=%owner_not_user, "scheduled action owner is not a user");
            return (StatusCode::BAD_REQUEST, owner_not_user.to_string()).into_response();
        }
        tracing::error!(error=?error, "scheduled action api error");
        (StatusCode::INTERNAL_SERVER_ERROR, "internal server error").into_response()
    }
}
