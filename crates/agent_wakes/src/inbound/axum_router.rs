//! HTTP routes for an agent account's wakes, mounted at the root:
//!
//! - `POST /agents/{agent_user_id}/wakes`: the agent records a wake record.
//! - `GET /agents/{agent_user_id}/wakes`: a page of its wakes, newest first.
//! - `GET /agents/{agent_user_id}/wakes/{wake_id}`: one wake.
//! - `PUT /agents/{agent_user_id}/wakes/{wake_id}/trace`: the agent replaces a
//!   wake's trace.
//! - `GET /agents/{agent_user_id}/wakes/{wake_id}/trace`: a wake's trace.
//!
//! Handlers authenticate the caller and hand the request to [`AgentWakes`],
//! which decides who may do what.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, put},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::domain::models::{
    Caller, MAX_TRACE_BYTES, StoredWake, WakeCursor, WakeError, WakeFilter, WakeStatus,
};
use crate::domain::record::WakeRecord;
use crate::domain::service::AgentWakes;
use crate::domain::trace::WakeTrace;

/// The largest wake record accepted, in bytes.
const MAX_RECORD_BYTES: usize = 64 * 1024;

/// State for the wake routes.
pub struct AgentWakesRouterState<Wakes, Auth> {
    service: Arc<Wakes>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Wakes, Auth> AgentWakesRouterState<Wakes, Auth> {
    /// Build the state.
    pub fn new(service: Wakes, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<Wakes, Auth> Clone for AgentWakesRouterState<Wakes, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Wakes, Auth> FromRef<AgentWakesRouterState<Wakes, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentWakesRouterState<Wakes, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the wake routes.
pub fn agent_wakes_router<Wakes, Auth, S>(state: AgentWakesRouterState<Wakes, Auth>) -> Router<S>
where
    Wakes: AgentWakes,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agents/{agent_user_id}/wakes",
            get(list_agent_wakes::<Wakes, Auth>)
                .post(record_agent_wake::<Wakes, Auth>)
                .layer(DefaultBodyLimit::max(MAX_RECORD_BYTES)),
        )
        .route(
            "/agents/{agent_user_id}/wakes/{wake_id}",
            get(get_agent_wake::<Wakes, Auth>),
        )
        .route(
            "/agents/{agent_user_id}/wakes/{wake_id}/trace",
            put(put_agent_wake_trace::<Wakes, Auth>)
                .get(get_agent_wake_trace::<Wakes, Auth>)
                .layer(DefaultBodyLimit::max(MAX_TRACE_BYTES)),
        )
        .with_state(state)
}

/// An agent account's path.
#[derive(Debug, Deserialize)]
pub struct AgentPath {
    /// The agent account's user id.
    pub agent_user_id: String,
}

/// One wake's path.
#[derive(Debug, Deserialize)]
pub struct WakePath {
    /// The agent account's user id.
    pub agent_user_id: String,
    /// The wake's id, as its record names it.
    pub wake_id: String,
}

/// A wake's status, for filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentWakeStatusFilter {
    /// No `end` record yet.
    Running,
    /// Ended ok.
    Ok,
    /// Failed.
    Failed,
    /// Timed out.
    Timeout,
    /// Cancelled.
    Cancelled,
}

impl From<AgentWakeStatusFilter> for WakeStatus {
    fn from(status: AgentWakeStatusFilter) -> Self {
        match status {
            AgentWakeStatusFilter::Running => Self::Running,
            AgentWakeStatusFilter::Ok => Self::Ok,
            AgentWakeStatusFilter::Failed => Self::Failed,
            AgentWakeStatusFilter::Timeout => Self::Timeout,
            AgentWakeStatusFilter::Cancelled => Self::Cancelled,
        }
    }
}

/// Which wakes to list, and from where.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentWakesQuery {
    /// Only wakes in this status; `running` is every wake with no `end` record yet.
    pub status: Option<AgentWakeStatusFilter>,
    /// Page size, 1 to 100; 25 when left out.
    pub limit: Option<u32>,
    /// `nextCursor` from the page before.
    pub cursor: Option<String>,
}

/// One wake: its latest record.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentWake {
    /// The latest record: `start`, `session`, or `end`.
    pub record: WakeRecord,
    /// When that record arrived.
    pub received_at: DateTime<Utc>,
    /// When the wake's trace was last uploaded, if it was.
    pub trace_updated_at: Option<DateTime<Utc>>,
}

impl From<StoredWake> for AgentWake {
    fn from(wake: StoredWake) -> Self {
        Self {
            record: wake.record,
            received_at: wake.received_at,
            trace_updated_at: wake.trace_updated_at,
        }
    }
}

/// A page of wakes, newest first.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentWakesPage {
    /// The wakes.
    pub wakes: Vec<AgentWake>,
    /// Pass as `cursor` for the next page; absent on the last.
    pub next_cursor: Option<String>,
}

/// Why a wake request failed, on the wire.
#[derive(Debug)]
pub struct AgentWakesApiError(WakeError);

impl From<WakeError> for AgentWakesApiError {
    fn from(error: WakeError) -> Self {
        Self(error)
    }
}

impl IntoResponse for AgentWakesApiError {
    fn into_response(self) -> Response {
        match self.0 {
            WakeError::NotFound => (StatusCode::NOT_FOUND, "not found").into_response(),
            error @ WakeError::Forbidden => {
                (StatusCode::FORBIDDEN, error.to_string()).into_response()
            }
            error @ WakeError::Invalid(_) => {
                (StatusCode::BAD_REQUEST, error.to_string()).into_response()
            }
            error @ WakeError::Conflict(_) => {
                (StatusCode::CONFLICT, error.to_string()).into_response()
            }
            WakeError::Storage(error) => {
                tracing::error!(error = ?error, "agent wakes request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

/// The path's agent id, or not found: an id that can't be a user's can't be
/// an agent account's.
fn agent_id(raw: String) -> Result<MacroUserIdStr<'static>, AgentWakesApiError> {
    MacroUserIdStr::try_from(raw).map_err(|_| AgentWakesApiError(WakeError::NotFound))
}

fn caller(user: MacroAuthorizationExtractor<impl MacroAuthorizationService, UserOnly>) -> Caller {
    Caller {
        user_id: user.authorization.macro_user_id,
    }
}

fn encode_cursor(cursor: &WakeCursor) -> Result<String, AgentWakesApiError> {
    let json = serde_json::to_vec(cursor).map_err(|error| {
        AgentWakesApiError(WakeError::Storage(rootcause::report!(
            "encode cursor: {error}"
        )))
    })?;
    Ok(URL_SAFE_NO_PAD.encode(json))
}

fn decode_cursor(cursor: &str) -> Result<WakeCursor, AgentWakesApiError> {
    URL_SAFE_NO_PAD
        .decode(cursor)
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .ok_or_else(|| AgentWakesApiError(WakeError::Invalid("cursor is not valid".to_owned())))
}

#[utoipa::path(
    post,
    path = "/agents/{agent_user_id}/wakes",
    tag = "agent-wakes",
    operation_id = "record_agent_wake",
    params(("agent_user_id" = String, Path, description = "User id of the agent account")),
    request_body = WakeRecord,
    responses(
        (status = 204, description = "Recorded, or older than the record already stored"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 409, body = String),
        (status = 500, body = String),
    )
)]
/// Record one of the caller's own wakes: a muppet `WakeRecord` (version 1),
/// unchanged. Only the agent account itself may. The latest record per wake id
/// is kept; repeating a record, or sending one of an earlier phase than the one
/// stored, changes nothing.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn record_agent_wake<Wakes: AgentWakes, Auth: MacroAuthorizationService>(
    State(state): State<AgentWakesRouterState<Wakes, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<AgentPath>,
    Json(record): Json<WakeRecord>,
) -> Result<StatusCode, AgentWakesApiError> {
    let agent = agent_id(path.agent_user_id)?;
    state.service.record(&caller(user), &agent, record).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/agents/{agent_user_id}/wakes",
    tag = "agent-wakes",
    operation_id = "list_agent_wakes",
    params(
        ("agent_user_id" = String, Path, description = "User id of the agent account"),
        ListAgentWakesQuery,
    ),
    responses(
        (status = 200, body = AgentWakesPage),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// A page of an agent account's wakes, newest first. Readable by the agent and
/// the owners and admins of its teams.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn list_agent_wakes<Wakes: AgentWakes, Auth: MacroAuthorizationService>(
    State(state): State<AgentWakesRouterState<Wakes, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<AgentPath>,
    Query(query): Query<ListAgentWakesQuery>,
) -> Result<Json<AgentWakesPage>, AgentWakesApiError> {
    let agent = agent_id(path.agent_user_id)?;
    let after = query.cursor.as_deref().map(decode_cursor).transpose()?;
    let filter = WakeFilter {
        status: query.status.map(WakeStatus::from),
    };

    let page = state
        .service
        .list(&caller(user), &agent, filter, after, query.limit)
        .await?;

    Ok(Json(AgentWakesPage {
        next_cursor: page.next.as_ref().map(encode_cursor).transpose()?,
        wakes: page.wakes.into_iter().map(AgentWake::from).collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/agents/{agent_user_id}/wakes/{wake_id}",
    tag = "agent-wakes",
    operation_id = "get_agent_wake",
    params(
        ("agent_user_id" = String, Path, description = "User id of the agent account"),
        ("wake_id" = String, Path, description = "The wake's id"),
    ),
    responses(
        (status = 200, body = AgentWake),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// One of an agent account's wakes.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_agent_wake<Wakes: AgentWakes, Auth: MacroAuthorizationService>(
    State(state): State<AgentWakesRouterState<Wakes, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<WakePath>,
) -> Result<Json<AgentWake>, AgentWakesApiError> {
    let agent = agent_id(path.agent_user_id)?;
    let wake = state
        .service
        .get(&caller(user), &agent, &path.wake_id)
        .await?;
    Ok(Json(wake.into()))
}

#[utoipa::path(
    put,
    path = "/agents/{agent_user_id}/wakes/{wake_id}/trace",
    tag = "agent-wakes",
    operation_id = "put_agent_wake_trace",
    params(
        ("agent_user_id" = String, Path, description = "User id of the agent account"),
        ("wake_id" = String, Path, description = "The wake's id"),
    ),
    request_body = WakeTrace,
    responses(
        (status = 204, description = "Stored"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 413, body = String),
        (status = 500, body = String),
    )
)]
/// Replace the trace of one of the caller's own recorded wakes: its model
/// session's turns and tool calls, redacted by the agent. Only the agent
/// account itself may. At most 10 MiB; kept 30 days after its last upload. A
/// live trace sent after the wake's `end` record is dropped, so the final trace
/// stands.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn put_agent_wake_trace<Wakes: AgentWakes, Auth: MacroAuthorizationService>(
    State(state): State<AgentWakesRouterState<Wakes, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<WakePath>,
    Json(trace): Json<WakeTrace>,
) -> Result<StatusCode, AgentWakesApiError> {
    let agent = agent_id(path.agent_user_id)?;
    state
        .service
        .put_trace(&caller(user), &agent, &path.wake_id, trace)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/agents/{agent_user_id}/wakes/{wake_id}/trace",
    tag = "agent-wakes",
    operation_id = "get_agent_wake_trace",
    params(
        ("agent_user_id" = String, Path, description = "User id of the agent account"),
        ("wake_id" = String, Path, description = "The wake's id"),
    ),
    responses(
        (status = 200, body = WakeTrace),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// The trace of one of an agent account's wakes, whole. Not found when none was
/// uploaded or it has expired.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn get_agent_wake_trace<Wakes: AgentWakes, Auth: MacroAuthorizationService>(
    State(state): State<AgentWakesRouterState<Wakes, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<WakePath>,
) -> Result<Json<WakeTrace>, AgentWakesApiError> {
    let agent = agent_id(path.agent_user_id)?;
    let trace = state
        .service
        .get_trace(&caller(user), &agent, &path.wake_id)
        .await?;
    Ok(Json(trace))
}
