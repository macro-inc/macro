use std::sync::Arc;

use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{
    ActionExecutionRecord, ActionPolicyError, AlreadyRunningError, CreateScheduledAction,
    InProgressExecution, OwnerNotUserError, Schedule, ScheduledAction, UpdateScheduledAction,
};
use crate::domain::ports::ScheduledActionService;
use crate::domain::target_validation::TargetValidationError;
use agent_session::domain::routines::RoutineSessionError;
use ai_billing::{AiAdmissionError, inbound::admission::AiAdmissionErrorBody};
use axum::extract::{FromRef, Path, Query, State, rejection::JsonRejection};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono_tz::Tz;
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ScheduledActionAccessExtractor;
use entity_registry::{CreationPrincipalExtractor, NonUserOwners, OwnedPurgeOutcome};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model::response::EmptyResponse;
use model_owner::Owner;
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
            _ => (None, None),
        };
        Self {
            action,
            schedule,
            timezone,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetScheduledActionEnabled {
    pub enabled: bool,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
pub struct ListActionsQuery {
    /// Backend clients must opt in to event actions; defaults to false (cron-only).
    #[param(default = false)]
    pub include_events: Option<bool>,
}

pub struct ScheduledActionRouterState<S, Svc, Auth> {
    pub service: Arc<S>,
    pub access_service: Arc<Svc>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Svc, Auth> Clone for ScheduledActionRouterState<S, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Svc, Auth> FromRef<ScheduledActionRouterState<S, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &ScheduledActionRouterState<S, Svc, Auth>) -> Self {
        Arc::clone(&state.access_service)
    }
}

impl<S, Svc, Auth> FromRef<ScheduledActionRouterState<S, Svc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ScheduledActionRouterState<S, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Team bots reach the domain so a non-user owner is `OwnerNotUserError`.
///
/// `NonUserOwners::Disabled` would reject that caller with a generic 403
/// before the service could return the explicit message.
impl<S, Svc, Auth> FromRef<ScheduledActionRouterState<S, Svc, Auth>> for NonUserOwners {
    fn from_ref(_state: &ScheduledActionRouterState<S, Svc, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

pub fn scheduled_action_router<S, Svc, Auth, St>(
    state: ScheduledActionRouterState<S, Svc, Auth>,
) -> Router<St>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/user/{user_id}",
            delete(delete_user_actions::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/internal/{id}",
            delete(purge_owned_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions",
            get(list_actions::<S, Svc, Auth>).post(create_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}",
            get(get_action::<S, Svc, Auth>)
                .put(update_action::<S, Svc, Auth>)
                .delete(delete_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/enabled",
            put(set_action_enabled::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/execute",
            post(execute_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/history",
            get(list_history::<S, Svc, Auth>),
        )
        .with_state(state)
}

async fn delete_user_actions<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(user_id): Path<MacroUserIdStr<'static>>,
) -> Result<StatusCode, ScheduledActionApiError>
where
    S: ScheduledActionService,
    Auth: MacroAuthorizationService,
{
    state.service.delete_user_actions(user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct OwnerQuery {
    owner: Owner,
}

/// Internal owner removal: never grants delete authority to a user or bot
/// token. 204 once the action is gone, including when it already was. 409
/// when another owner holds it, and nothing was deleted. 500 when the delete
/// failed; the purge converges, so the caller retries.
#[tracing::instrument(skip_all, fields(%id, owner.kind = ?owner.owner_type()))]
async fn purge_owned_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(id): Path<Uuid>,
    Query(OwnerQuery { owner }): Query<OwnerQuery>,
) -> StatusCode
where
    S: ScheduledActionService,
    Auth: MacroAuthorizationService,
{
    match state.service.purge_owned_action(id, &owner).await {
        Ok(OwnedPurgeOutcome::Purged) => StatusCode::NO_CONTENT,
        Ok(OwnedPurgeOutcome::OwnedElsewhere) => StatusCode::CONFLICT,
        Err(error) => {
            tracing::error!(error = ?error, "unable to purge the owned scheduled action");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
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
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
pub async fn create_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<CreateScheduledAction>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let created = state.service.create_action(&principal, req).await?;
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
pub async fn list_actions<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<ListActionsQuery>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Auth: MacroAuthorizationService,
{
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
    get,
    path = "/scheduled-actions/{id}",
    tag = "scheduled actions",
    operation_id = "get_scheduled_action",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 200, body = ScheduledActionResponse),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn get_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<ScheduledActionResponse>, ScheduledActionApiError>
where
    S: ScheduledActionService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let action = state.service.get_action(entity_access_receipt).await?;
    Ok(Json(action.into()))
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
pub async fn update_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
    body: Result<Json<UpdateScheduledAction>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let updated = state
        .service
        .update_action(entity_access_receipt, req)
        .await?;
    Ok(Json(ScheduledActionResponse::from(updated)))
}

#[utoipa::path(
    put,
    path = "/scheduled-actions/{id}/enabled",
    tag = "scheduled actions",
    operation_id = "set_scheduled_action_enabled",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    request_body = SetScheduledActionEnabled,
    responses(
        (status = 200, body = ScheduledActionResponse),
        (status = 400, body = String),
        (status = 409, body = String, description = "Configuration changed or execution is active"),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn set_action_enabled<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
    body: Result<Json<SetScheduledActionEnabled>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let action = state
        .service
        .set_enabled(entity_access_receipt, req.enabled)
        .await?;
    Ok(Json(ScheduledActionResponse::from(action)))
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
pub async fn delete_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state.service.delete_action(entity_access_receipt).await?;
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
        (status = 402, body = AiAdmissionErrorBody, description = "AI allowance exhausted"),
        (status = 503, body = AiAdmissionErrorBody, description = "AI usage validation unavailable; retry later"),
        (status = 500, body = String),
    )
)]
pub async fn execute_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let execution = state
        .service
        .execute_action_now(entity_access_receipt)
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
pub async fn list_history<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let records = state
        .service
        .get_execution_records(entity_access_receipt)
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
        if let Some(admission) = error.downcast_ref::<AiAdmissionError>() {
            return (*admission).into_response();
        }
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
        if let Some(validation) = error.downcast_ref::<TargetValidationError>() {
            let status = match validation {
                TargetValidationError::InvalidTask | TargetValidationError::AgentsDisabled => {
                    StatusCode::BAD_REQUEST
                }
                TargetValidationError::ExplicitAgentRequired => StatusCode::CONFLICT,
            };
            return (status, validation.to_string()).into_response();
        }
        if let Some(session) = error.downcast_ref::<RoutineSessionError>() {
            let (status, message) = match session {
                RoutineSessionError::Admission(error) => return (*error).into_response(),
                RoutineSessionError::InvalidCommand | RoutineSessionError::ModelMismatch => {
                    (StatusCode::BAD_REQUEST, session.to_string())
                }
                RoutineSessionError::PersonaUnavailable => {
                    (StatusCode::NOT_FOUND, session.to_string())
                }
                RoutineSessionError::Forbidden => (StatusCode::FORBIDDEN, session.to_string()),
                RoutineSessionError::Conflict => (StatusCode::CONFLICT, session.to_string()),
                RoutineSessionError::RuntimeUnavailable | RoutineSessionError::OperationFailed => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "agent service is unavailable".to_owned(),
                ),
                RoutineSessionError::PromptDeliveryUnknown => {
                    (StatusCode::SERVICE_UNAVAILABLE, session.to_string())
                }
                RoutineSessionError::SessionMismatch => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_owned(),
                ),
            };
            return (status, message).into_response();
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
