use std::sync::Arc;

use crate::domain::catalog::CatalogEntry;
use crate::domain::code_check::CodeCheckError;
use crate::domain::code_upgrade::CodeUpgrade;
use crate::domain::drafts::InvalidDraft;
use crate::domain::drafts::jobs::DraftJobError;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, ActionPolicyError,
    AlreadyRunningError, CreatedItem, CreatedRoutine, InProgressExecution, ListScope, ListedAction,
    ListedRun, OwnerNotUserError, RoutineCheck, RunCaller, Schedule, ScheduledAction,
    SubRoutineKey,
};
use crate::domain::ports::{SavedAction, ScheduledActionService};
use crate::domain::target_validation::TargetValidationError;
use crate::domain::templates::TemplateInputError;
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
    UserOnly, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model::response::EmptyResponse;
use model_entity::EntityAppearance;
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[cfg(test)]
pub(crate) mod test;

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
    /// The latest finished run, with what each step did. Present only in
    /// lists, and only once the routine has finished a run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<ActionExecutionRecord>,
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
            last_run: None,
        }
    }
}

impl From<ListedAction> for ScheduledActionResponse {
    fn from(listed: ListedAction) -> Self {
        Self {
            last_run: listed.last_run,
            ..Self::from(listed.action)
        }
    }
}

/// A routine to check, as the create body takes it.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckRoutineRequest {
    pub routine: ActionConfiguration,
    /// What a routine draft's session created for the routine to use, such as
    /// the database it writes to; kept with its draft for the person to see.
    #[serde(default)]
    pub created: Vec<CreatedItem>,
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
    /// Also list active sub-routines, the routines other routines' runs
    /// created, without finished one-time ones; defaults to false (top-level
    /// routines only).
    #[param(default = false)]
    pub include_children: Option<bool>,
    /// List only this routine's sub-routines: the active ones and its newest
    /// 200 finished one-time ones.
    #[param(value_type = Option<String>, format = Uuid)]
    pub parent: Option<Uuid>,
}

/// A finished run, with the routines it created.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExecutionRecordResponse {
    #[serde(flatten)]
    pub record: ActionExecutionRecord,
    /// The sub-routines this run created that still follow the routine.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub created: Vec<CreatedRoutine>,
}

impl From<ListedRun> for ExecutionRecordResponse {
    fn from(run: ListedRun) -> Self {
        Self {
            record: run.record,
            created: run.created,
        }
    }
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
            "/scheduled-actions/{id}/appearance",
            put(set_appearance::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/enabled",
            put(set_action_enabled::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/detach",
            post(detach_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/execute",
            post(execute_action::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/history",
            get(list_history::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/code-upgrades",
            get(list_code_upgrades::<S, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/check",
            post(check_action::<S, Svc, Auth>),
        )
        .route("/scheduled-actions/catalog", get(catalog::<S, Svc, Auth>))
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

/// Where a new routine came from.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CreateActionQuery {
    /// The routine suggestion it is saved from, recorded on the routine.
    #[param(value_type = Option<String>, format = Uuid)]
    pub suggestion_id: Option<Uuid>,
    /// A name for a routine a routine's run creates: the same key under the
    /// same parent updates that sub-routine instead of adding another.
    /// Rejected outside a routine's run.
    pub key: Option<String>,
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/check",
    tag = "scheduled actions",
    operation_id = "check_scheduled_action",
    request_body = CheckRoutineRequest,
    responses(
        (status = 200, body = RoutineCheck),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
        (status = 503, body = String),
    )
)]
/// What saving this routine would find wrong, without saving it: the same
/// checks as creating it. A routine draft's session hands its draft back
/// this way.
pub async fn check_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<CheckRoutineRequest>, JsonRejection>,
) -> Result<Json<RoutineCheck>, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(CheckRoutineRequest { routine, created }) =
        body.map_err(ScheduledActionApiError::InvalidRequest)?;
    // The code-mode invocation the credential names, already validated
    // against its session at the router's boundary.
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .check_action(&principal, routine, created, correlation)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions",
    tag = "scheduled actions",
    operation_id = "create_scheduled_action",
    params(CreateActionQuery),
    request_body = ActionConfiguration,
    responses(
        (status = 201, body = ScheduledActionResponse),
        (status = 200, body = ScheduledActionResponse, description = "The sub-routine its key already named, updated"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 409, body = String, description = "The routine already has the most active sub-routines it can"),
        (status = 500, body = String),
    )
)]
/// Create a routine. A create made by a routine's run, from its code step
/// or its Ask AI step's session, makes that routine's sub-routine: the
/// caller's credential says so, never the body.
pub async fn create_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Query(query): Query<CreateActionQuery>,
    body: Result<Json<ActionConfiguration>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let created = match query.suggestion_id {
        Some(suggestion_id) => {
            state
                .service
                .create_action_from_suggestion(&principal, req, suggestion_id)
                .await?
        }
        None => {
            // Both come from the request's verified credential: the routine
            // a code step's token is signed for, and the code-mode
            // invocation of an agent session.
            let caller = RunCaller {
                routine: agent_correlation::context::current_routine(),
                correlation: agent_correlation::context::current(),
            };
            let key = query
                .key
                .as_deref()
                .map(SubRoutineKey::new)
                .transpose()
                .map_err(anyhow::Error::from)?;
            let saved = state
                .service
                .create_action_from(&principal, req, caller, key)
                .await?;
            let status = match saved {
                SavedAction::Created(_) => StatusCode::CREATED,
                SavedAction::Updated(_) => StatusCode::OK,
            };
            return Ok((
                status,
                Json(ScheduledActionResponse::from(saved.into_action())),
            ));
        }
    };
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
            match (query.parent, query.include_children.unwrap_or(false)) {
                (Some(parent), _) => ListScope::ChildrenOf(parent),
                (None, true) => ListScope::WithChildren,
                (None, false) => ListScope::TopLevel,
            },
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
    let action = state.service.get_action(&entity_access_receipt).await?;
    Ok(Json(action.into()))
}

#[utoipa::path(
    put,
    path = "/scheduled-actions/{id}",
    tag = "scheduled actions",
    operation_id = "update_scheduled_action",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    request_body = ActionConfigurationUpdate,
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
    body: Result<Json<ActionConfigurationUpdate>, JsonRejection>,
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
    path = "/scheduled-actions/{id}/appearance",
    tag = "scheduled actions",
    operation_id = "set_scheduled_action_appearance",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    request_body = EntityAppearance,
    responses((status = 200, body = EntityAppearance), (status = 400), (status = 401), (status = 404)),
)]
pub async fn set_appearance<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
    body: Result<Json<EntityAppearance>, JsonRejection>,
) -> Result<Json<EntityAppearance>, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(appearance) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    Ok(Json(
        state
            .service
            .set_appearance(entity_access_receipt, appearance)
            .await?,
    ))
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
    path = "/scheduled-actions/{id}/detach",
    tag = "scheduled actions",
    operation_id = "detach_scheduled_action",
    params(("id" = String, Path, description = "ID of the sub-routine")),
    responses(
        (status = 200, body = ScheduledActionResponse),
        (status = 400, body = String, description = "Not a sub-routine"),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// Keep a sub-routine as the owner's own routine: it moves to the main list
/// and no longer follows the routine whose run created it.
pub async fn detach_action<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let action = state.service.detach_action(entity_access_receipt).await?;
    Ok(Json(ScheduledActionResponse::from(action)))
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
        (status = 200, body = Vec<ExecutionRecordResponse>),
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
    Ok(Json(
        records
            .into_iter()
            .map(ExecutionRecordResponse::from)
            .collect::<Vec<_>>(),
    ))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/code-upgrades",
    tag = "scheduled actions",
    operation_id = "list_scheduled_action_code_upgrades",
    params(("id" = String, Path, description = "ID of the scheduled action")),
    responses(
        (status = 200, body = Vec<CodeUpgrade>, description = "How the routine's code steps were brought to new SDKs, newest first"),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn list_code_upgrades<S, Svc, Auth>(
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
    let upgrades = state
        .service
        .get_code_upgrades(entity_access_receipt)
        .await?;
    Ok(Json(upgrades))
}

/// Which zone the catalog's schedules are written in.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CatalogQuery {
    /// IANA time zone, e.g. `America/New_York`.
    #[param(value_type = String)]
    pub timezone: Tz,
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/catalog",
    tag = "scheduled actions",
    operation_id = "routine_catalog",
    params(CatalogQuery),
    responses(
        (status = 200, body = Vec<CatalogEntry>, description = "Macro's routines, with schedules in the given zone; code steps only where code can be saved"),
        (status = 400, body = String, description = "Not a time zone"),
        (status = 401, body = String),
    )
)]
pub async fn catalog<S, Svc, Auth>(
    State(state): State<ScheduledActionRouterState<S, Svc, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<CatalogQuery>,
) -> Json<Vec<CatalogEntry>>
where
    S: ScheduledActionService + Send + Sync + 'static,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Json(state.service.catalog(query.timezone))
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
                // The caller's own input, naming the field it rejected.
                return (status, rejection.body_text()).into_response();
            }
            Self::Service(error) => error,
        };
        if let Some(admission) = error.downcast_ref::<AiAdmissionError>() {
            return (*admission).into_response();
        }
        if let Some(policy) = error.downcast_ref::<ActionPolicyError>() {
            let status = match policy {
                ActionPolicyError::NotFound => StatusCode::NOT_FOUND,
                ActionPolicyError::UpdateConflict | ActionPolicyError::TooManySubRoutines => {
                    StatusCode::CONFLICT
                }
                ActionPolicyError::NotSuggesting => StatusCode::FORBIDDEN,
                ActionPolicyError::NoFutureFirings
                | ActionPolicyError::EventManagementDisabled
                | ActionPolicyError::ConditionsDisabled
                | ActionPolicyError::InvalidAppearance(_)
                | ActionPolicyError::GithubNotLinked
                | ActionPolicyError::DescriptionTooLong
                | ActionPolicyError::KeyOutsideRun
                | ActionPolicyError::InvalidKey
                | ActionPolicyError::NotSubRoutine => StatusCode::BAD_REQUEST,
            };
            return (status, policy.to_string()).into_response();
        }
        if let Some(draft) = error.downcast_ref::<InvalidDraft>() {
            return (StatusCode::BAD_REQUEST, draft.to_string()).into_response();
        }
        if let Some(job) = error.downcast_ref::<DraftJobError>() {
            let status = match job {
                DraftJobError::NotFound => StatusCode::NOT_FOUND,
                DraftJobError::TooMany => StatusCode::CONFLICT,
            };
            return (status, job.to_string()).into_response();
        }
        if let Some(code) = error.downcast_ref::<CodeCheckError>() {
            let status = match code {
                CodeCheckError::DoesNotCheck { .. } => StatusCode::BAD_REQUEST,
                CodeCheckError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            };
            return (status, code.to_string()).into_response();
        }
        if let Some(input) = error.downcast_ref::<TemplateInputError>() {
            return (StatusCode::BAD_REQUEST, input.to_string()).into_response();
        }
        if let Some(validation) = error.downcast_ref::<TargetValidationError>() {
            let status = match validation {
                TargetValidationError::InvalidTask
                | TargetValidationError::InvalidProgram(_)
                | TargetValidationError::SessionsUnavailable => StatusCode::BAD_REQUEST,
                TargetValidationError::ExplicitAgentRequired
                | TargetValidationError::ExplicitAppsRequired
                | TargetValidationError::ExplicitStepsRequired => StatusCode::CONFLICT,
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
                RoutineSessionError::AppNotConnected | RoutineSessionError::AppsUnsupported => {
                    (StatusCode::UNPROCESSABLE_ENTITY, session.to_string())
                }
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
