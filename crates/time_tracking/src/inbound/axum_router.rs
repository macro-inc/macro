//! Axum router for time entries and the running timer, nested at `/time`.
//!
//! Task routes mint a view or edit receipt for the task and pass it inward;
//! entry and timer routes pass the authenticated user. Policy lives in the
//! domain service.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use tracing::Level;
use uuid::Uuid;

use crate::domain::{
    models::{
        FieldEdit, LoggedTime, NewTimeEntry, RunningTimer, StartTimer, StartedTimer, StopTimer,
        StoppedTimer, TaskTimeTotal, TimeEntryChanges, TimeEntryCursor, TimeEntryPage,
        TimeEntryPageRequest, TimeTrackingError, TimerEnding, TimerState, parse_time_zone,
    },
    service::TimeTrackingService,
};

/// Router state for the time tracking endpoints.
pub struct TimeTrackingRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for TimeTrackingRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> TimeTrackingRouterState<S, Eas, Auth> {
    /// Create router state from the service, entity access and authorization.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<TimeTrackingRouterState<S, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &TimeTrackingRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the time tracking router.
///
/// Routes:
/// - `GET /tasks/{task_id}/entries` — a task's entries (view access).
/// - `POST /tasks/{task_id}/entries` — log typed time (edit access).
/// - `PATCH /entries/{entry_id}` — change one's own entry.
/// - `DELETE /entries/{entry_id}` — delete one's own entry.
/// - `GET /timer` — the caller's running timer.
/// - `POST /timer/start` — start timing a task (edit access).
/// - `POST /timer/stop` — stop the caller's timer and save its entry.
/// - `POST /timer/discard` — discard the caller's timer.
pub fn time_tracking_router<S, Eas, Auth, T>(
    state: TimeTrackingRouterState<S, Eas, Auth>,
) -> Router<T>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/tasks/{task_id}/entries",
            get(list_time_entries_handler::<S, Eas, Auth>).post(log_time_handler::<S, Eas, Auth>),
        )
        .route(
            "/entries/{entry_id}",
            patch(update_time_entry_handler::<S, Eas, Auth>)
                .delete(delete_time_entry_handler::<S, Eas, Auth>),
        )
        .route("/timer", get(get_timer_handler::<S, Eas, Auth>))
        .route("/timer/start", post(start_timer_handler::<S, Eas, Auth>))
        .route("/timer/stop", post(stop_timer_handler::<S, Eas, Auth>))
        .route(
            "/timer/discard",
            post(discard_timer_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

/// Machine-readable reason a time tracking request failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimeTrackingErrorCode {
    /// The task, entry or timer does not exist or is hidden from the caller.
    NotFound,
    /// The caller may not do this to the task.
    Forbidden,
    /// The caller can see the entry but did not log it.
    NotAuthor,
    /// The request breaks an entry or timer rule.
    InvalidInput,
    /// The timer ran past the limit; resend with `endedAt` or `logAll`, or discard it.
    TimerOverLimit,
    /// The id is taken, or the timer changed under the request.
    Conflict,
    /// A dependency is briefly unavailable; retrying may succeed.
    Unavailable,
    /// The server failed.
    Internal,
}

/// Error body of the time tracking endpoints.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TimeTrackingApiError {
    /// Machine-readable failure category.
    pub code: TimeTrackingErrorCode,
    /// Human-readable failure description.
    pub message: String,
    /// The timer that ran past the limit, with `timer_over_limit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timer: Option<RunningTimer>,
    #[serde(skip)]
    status: StatusCode,
}

impl TimeTrackingApiError {
    fn new(status: StatusCode, code: TimeTrackingErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            timer: None,
            status,
        }
    }
}

impl std::fmt::Display for TimeTrackingApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl IntoResponse for TimeTrackingApiError {
    fn into_response(self) -> Response {
        (self.status, Json(&self)).into_response()
    }
}

impl From<TimeTrackingError> for TimeTrackingApiError {
    fn from(error: TimeTrackingError) -> Self {
        use TimeTrackingErrorCode as Code;
        let message = error.to_string();
        match error {
            TimeTrackingError::NotFound(_) => {
                Self::new(StatusCode::NOT_FOUND, Code::NotFound, message)
            }
            TimeTrackingError::NotAuthor => {
                Self::new(StatusCode::FORBIDDEN, Code::NotAuthor, message)
            }
            TimeTrackingError::InvalidInput(_) => {
                Self::new(StatusCode::BAD_REQUEST, Code::InvalidInput, message)
            }
            TimeTrackingError::TimerOverLimit(timer) => Self {
                timer: Some(timer),
                ..Self::new(StatusCode::CONFLICT, Code::TimerOverLimit, message)
            },
            TimeTrackingError::Conflict(_) => {
                Self::new(StatusCode::CONFLICT, Code::Conflict, message)
            }
            TimeTrackingError::Busy => {
                Self::new(StatusCode::SERVICE_UNAVAILABLE, Code::Unavailable, message)
            }
            TimeTrackingError::Internal(report) => {
                tracing::error!(error = ?report, "time tracking internal error");
                Self::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Code::Internal,
                    "internal server error",
                )
            }
        }
    }
}

impl From<AccessError> for TimeTrackingApiError {
    fn from(error: AccessError) -> Self {
        use TimeTrackingErrorCode as Code;
        match error {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => Self::new(
                StatusCode::FORBIDDEN,
                Code::Forbidden,
                "you do not have the access this needs on the task",
            ),
            AccessError::NotFound(_) => {
                Self::new(StatusCode::NOT_FOUND, Code::NotFound, "task not found")
            }
            AccessError::BadRequest(message) => {
                Self::new(StatusCode::BAD_REQUEST, Code::InvalidInput, message)
            }
            AccessError::Unavailable(report) => {
                tracing::warn!(error = ?report, "task access check unavailable");
                Self::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    Code::Unavailable,
                    "the access check is briefly unavailable; try again",
                )
            }
            AccessError::Internal(report) => {
                tracing::error!(error = ?report, "task access check failed");
                Self::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Code::Internal,
                    "internal server error",
                )
            }
        }
    }
}

async fn task_receipt<
    T: RequiredPermission,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: &Eas,
    user: &MacroAuthorizationExtractor<Auth, UserOnly>,
    task_id: &str,
) -> Result<EntityAccessReceipt<T>, TimeTrackingApiError> {
    Ok(access
        .generate_entity_access_receipt::<T>(
            &user.authorization.macro_user_id,
            None,
            task_id,
            EntityType::Document,
        )
        .await?)
}

/// Path params naming a task.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct TaskPathParams {
    /// The task document's id.
    pub task_id: String,
}

/// Path params naming an entry.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct TimeEntryPathParams {
    /// The entry's id.
    pub entry_id: Uuid,
}

/// Which page of a task's entries to list.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ListTimeEntriesQuery {
    /// Entries per page, 1 to 200; 50 when omitted.
    #[param(minimum = 1, maximum = 200)]
    pub limit: Option<u8>,
    /// The `date` of the previous page's `nextCursor`.
    pub cursor_date: Option<NaiveDate>,
    /// The `id` of the previous page's `nextCursor`.
    pub cursor_id: Option<Uuid>,
}

/// Typed time to log on a task.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogTimeRequest {
    /// A UUIDv7 chosen by the client, so a retry logs once; generated when omitted.
    #[serde(default)]
    pub id: Option<Uuid>,
    /// The logger's calendar day for the work, `YYYY-MM-DD`.
    pub date: NaiveDate,
    /// Length in whole minutes, 1 to 1440.
    #[schema(minimum = 1, maximum = 1440)]
    pub minutes: u16,
    /// What the time was spent on, up to 2000 characters.
    #[serde(default)]
    pub note: Option<String>,
    /// When the work started; given with `endedAt` or not at all.
    #[serde(default)]
    pub started_at: Option<DateTime<Utc>>,
    /// When the work ended, after `startedAt`.
    #[serde(default)]
    pub ended_at: Option<DateTime<Utc>>,
}

/// Changes to one's own entry. Omitted fields stay; `null` clears a note or span.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateTimeEntryRequest {
    /// A new day, `YYYY-MM-DD`.
    #[serde(default)]
    pub date: Option<NaiveDate>,
    /// A new length in whole minutes, 1 to 1440.
    #[serde(default)]
    #[schema(minimum = 1, maximum = 1440)]
    pub minutes: Option<u16>,
    /// A new note, or `null` for none.
    #[serde(default, with = "::serde_with::rust::double_option")]
    #[schema(value_type = Option<String>, nullable)]
    pub note: Option<Option<String>>,
    /// A new start, or `null` to clear the span; changed with `endedAt`.
    #[serde(default, with = "::serde_with::rust::double_option")]
    #[schema(value_type = Option<DateTime<Utc>>, nullable)]
    pub started_at: Option<Option<DateTime<Utc>>>,
    /// A new end, or `null` to clear the span; changed with `startedAt`.
    #[serde(default, with = "::serde_with::rust::double_option")]
    #[schema(value_type = Option<DateTime<Utc>>, nullable)]
    pub ended_at: Option<Option<DateTime<Utc>>>,
}

/// Start timing a task.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartTimerRequest {
    /// A UUIDv7 chosen by the client, so a retry starts once; generated when omitted.
    #[serde(default)]
    pub id: Option<Uuid>,
    /// The task to time.
    pub task_id: String,
    /// IANA zone whose day a stopped previous timer's entry takes; UTC when omitted.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// An earlier start within the last 24 hours; only Undo on a switch sends it.
    #[serde(default)]
    pub started_at: Option<DateTime<Utc>>,
}

/// Stop the caller's timer.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopTimerRequest {
    /// The timer to stop.
    pub timer_id: Uuid,
    /// IANA zone whose calendar day the entry takes; UTC when omitted.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// When the person stopped working, for a timer past the limit.
    #[serde(default)]
    pub ended_at: Option<DateTime<Utc>>,
    /// Log all the time until now, for a timer past the limit.
    #[serde(default)]
    pub log_all: bool,
}

/// Discard the caller's timer.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscardTimerRequest {
    /// The timer to discard.
    pub timer_id: Uuid,
}

/// List a task's time entries, newest day first, with its Time logged.
#[utoipa::path(
    get,
    tag = "time_tracking",
    operation_id = "list_time_entries",
    path = "/time/tasks/{task_id}/entries",
    params(TaskPathParams, ListTimeEntriesQuery),
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = TimeEntryPage),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn list_time_entries_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<TaskPathParams>,
    Query(query): Query<ListTimeEntriesQuery>,
) -> Result<Json<TimeEntryPage>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let after = match (query.cursor_date, query.cursor_id) {
        (None, None) => None,
        (Some(date), Some(id)) => Some(TimeEntryCursor { date, id }),
        _ => {
            return Err(TimeTrackingError::InvalidInput(
                "give both cursorDate and cursorId, or neither".to_string(),
            )
            .into());
        }
    };
    let receipt = task_receipt(&*state.entity_access_service, &user, &params.task_id).await?;
    let page = state
        .service
        .list_entries(
            &receipt,
            TimeEntryPageRequest {
                limit: query.limit,
                after,
            },
        )
        .await?;
    Ok(Json(page))
}

/// Log typed time on a task. Resending the same `id` returns the stored entry.
#[utoipa::path(
    post,
    tag = "time_tracking",
    operation_id = "log_time",
    path = "/time/tasks/{task_id}/entries",
    params(TaskPathParams),
    request_body = LogTimeRequest,
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = LoggedTime),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 409, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn log_time_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<TaskPathParams>,
    Json(request): Json<LogTimeRequest>,
) -> Result<Json<LoggedTime>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = task_receipt(&*state.entity_access_service, &user, &params.task_id).await?;
    let logged = state
        .service
        .log_entry(
            &receipt,
            NewTimeEntry {
                id: request.id,
                date: request.date,
                minutes: request.minutes,
                note: request.note,
                started_at: request.started_at,
                ended_at: request.ended_at,
            },
        )
        .await?;
    Ok(Json(logged))
}

/// Change one's own time entry.
#[utoipa::path(
    patch,
    tag = "time_tracking",
    operation_id = "update_time_entry",
    path = "/time/entries/{entry_id}",
    params(TimeEntryPathParams),
    request_body = UpdateTimeEntryRequest,
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = LoggedTime),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn update_time_entry_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<TimeEntryPathParams>,
    Json(request): Json<UpdateTimeEntryRequest>,
) -> Result<Json<LoggedTime>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let logged = state
        .service
        .update_entry(
            &user.authorization.macro_user_id,
            params.entry_id,
            TimeEntryChanges {
                date: request.date,
                minutes: request.minutes,
                note: FieldEdit::from_nullable(request.note),
                started_at: FieldEdit::from_nullable(request.started_at),
                ended_at: FieldEdit::from_nullable(request.ended_at),
            },
        )
        .await?;
    Ok(Json(logged))
}

/// Delete one's own time entry.
#[utoipa::path(
    delete,
    tag = "time_tracking",
    operation_id = "delete_time_entry",
    path = "/time/entries/{entry_id}",
    params(TimeEntryPathParams),
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = TaskTimeTotal),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn delete_time_entry_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<TimeEntryPathParams>,
) -> Result<Json<TaskTimeTotal>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let total = state
        .service
        .delete_entry(&user.authorization.macro_user_id, params.entry_id)
        .await?;
    Ok(Json(total))
}

/// The caller's running timer, if any, and the server's clock.
#[utoipa::path(
    get,
    tag = "time_tracking",
    operation_id = "get_timer",
    path = "/time/timer",
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = TimerState),
        (status = 500, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn get_timer_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<TimerState>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .timer(&user.authorization.macro_user_id)
            .await?,
    ))
}

/// Start timing a task. A timer running on another task stops and is saved in
/// the same call, unless it ran past the limit (`timer_over_limit`).
#[utoipa::path(
    post,
    tag = "time_tracking",
    operation_id = "start_timer",
    path = "/time/timer/start",
    request_body = StartTimerRequest,
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = StartedTimer),
        (status = 400, body = TimeTrackingApiError),
        (status = 403, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 409, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn start_timer_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<StartTimerRequest>,
) -> Result<Json<StartedTimer>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let time_zone = parse_time_zone(request.time_zone.as_deref())?;
    let receipt = task_receipt(&*state.entity_access_service, &user, &request.task_id).await?;
    let started = state
        .service
        .start_timer(
            &receipt,
            StartTimer {
                id: request.id,
                time_zone,
                started_at: request.started_at,
            },
        )
        .await?;
    Ok(Json(started))
}

/// Stop the caller's timer and save its entry. A timer past the limit needs
/// `endedAt` or `logAll`. Stopping a timer that already stopped returns its
/// entry; one that was discarded returns `logged: null`.
#[utoipa::path(
    post,
    tag = "time_tracking",
    operation_id = "stop_timer",
    path = "/time/timer/stop",
    request_body = StopTimerRequest,
    responses(
        (status = 401, body = ErrorResponse),
        (status = 200, body = StoppedTimer),
        (status = 400, body = TimeTrackingApiError),
        (status = 404, body = TimeTrackingApiError),
        (status = 409, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn stop_timer_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<StopTimerRequest>,
) -> Result<Json<StoppedTimer>, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let stop = StopTimer {
        timer_id: request.timer_id,
        time_zone: parse_time_zone(request.time_zone.as_deref())?,
        ending: TimerEnding::from_request(request.ended_at, request.log_all)?,
    };
    let stopped = state
        .service
        .stop_timer(&user.authorization.macro_user_id, stop)
        .await?;
    Ok(Json(stopped))
}

/// Discard the caller's timer; nothing is saved.
#[utoipa::path(
    post,
    tag = "time_tracking",
    operation_id = "discard_timer",
    path = "/time/timer/discard",
    request_body = DiscardTimerRequest,
    responses(
        (status = 401, body = ErrorResponse),
        (status = 204),
        (status = 404, body = TimeTrackingApiError),
        (status = 500, body = TimeTrackingApiError),
        (status = 503, body = TimeTrackingApiError),
    )
)]
#[tracing::instrument(skip_all, err(level = Level::INFO))]
pub async fn discard_timer_handler<S, Eas, Auth>(
    State(state): State<TimeTrackingRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(request): Json<DiscardTimerRequest>,
) -> Result<StatusCode, TimeTrackingApiError>
where
    S: TimeTrackingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .discard_timer(&user.authorization.macro_user_id, request.timer_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
