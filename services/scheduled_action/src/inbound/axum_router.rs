use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::Utc;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_uuid::Uuid;
use model::response::EmptyResponse;

use crate::domain::models::{
    ActionExecutionRecord, AlreadyRunningError, CreateScheduledAction, InProgressExecution,
    ScheduledAction, UpdateScheduledAction,
};
use crate::domain::ports::ScheduledActionService;

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
        (status = 201, body = ScheduledAction),
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
    Json(req): Json<CreateScheduledAction>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let now = Utc::now();
    let next_run_at = req
        .schedule
        .next_run_after_now(req.timezone)
        .ok_or_else(|| anyhow::anyhow!("schedule has no future firings"))?;
    let action = ScheduledAction {
        id: None,
        owner: user.authorization.user.macro_user_id.clone(),
        name: req.name,
        schedule: req.schedule,
        kind: req.kind,
        created_at: now,
        updated_at: now,
        timezone: req.timezone,
        task: req.task,
        claimed: None,
        next_run_at,
        enabled: req.enabled,
    };
    let created = state.service.create_action(action).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions",
    tag = "scheduled actions",
    operation_id = "list_scheduled_actions",
    responses(
        (status = 200, body = Vec<ScheduledAction>),
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
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let actions = state
        .service
        .get_actions(user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(actions))
}

#[utoipa::path(
    put,
    path = "/scheduled-actions/{id}",
    tag = "scheduled actions",
    operation_id = "update_scheduled_action",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    request_body = UpdateScheduledAction,
    responses(
        (status = 200, body = ScheduledAction),
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
    Json(req): Json<UpdateScheduledAction>,
) -> Result<impl IntoResponse, ScheduledActionApiError> {
    let now = Utc::now();
    let next_run_at = req
        .schedule
        .next_run_after_now(req.timezone)
        .ok_or_else(|| anyhow::anyhow!("schedule has no future firings"))?;
    let action = ScheduledAction {
        id: Some(id),
        owner: user.authorization.user.macro_user_id.clone(),
        name: req.name,
        schedule: req.schedule,
        kind: req.kind,
        created_at: now,
        updated_at: now,
        timezone: req.timezone,
        task: req.task,
        claimed: None,
        next_run_at,
        enabled: req.enabled,
    };
    let updated = state
        .service
        .update_action(action, user.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(updated))
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

pub struct ScheduledActionApiError(anyhow::Error);

impl From<anyhow::Error> for ScheduledActionApiError {
    fn from(err: anyhow::Error) -> Self {
        Self(err)
    }
}

impl IntoResponse for ScheduledActionApiError {
    fn into_response(self) -> axum::response::Response {
        if let Some(already_running) = self.0.downcast_ref::<AlreadyRunningError>() {
            tracing::info!(error=%already_running, "scheduled action already running");
            return (StatusCode::CONFLICT, already_running.to_string()).into_response();
        }
        tracing::error!(error=?self.0, "scheduled action api error");
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}
