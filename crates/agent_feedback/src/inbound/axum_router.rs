//! The feedback routes: a person rates, changes, retracts and lists their
//! ratings of agent responses in a session, a message parent or a routine;
//! internal callers export every row for evals.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{AccessError, EntityAccessReceipt, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    AgentSessionAccessLevelExtractor, ScheduledActionAccessExtractor,
    principal_entity_access_receipt,
};
use macro_authorization::{
    InternalOnly, MacroAuthorization, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOnly,
};
use messages::domain::models::MessageParent;
use messages::domain::service::MessageView;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::model::{
    ExportCursor, ExportLimit, ExportPage, FeedbackContainer, FeedbackError, FeedbackState,
    MyFeedback, RateRequest, RatedResponse, Rating, RetractRequest, Surface,
};
use crate::domain::ports::FeedbackApi;

#[cfg(test)]
mod test;

/// What the feedback routes share.
pub struct AgentFeedbackRouterState<S, Access, Auth> {
    service: Arc<S>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<S, Access, Auth> AgentFeedbackRouterState<S, Access, Auth> {
    /// The service, the entity access its receipts are minted through, and
    /// the caller's authorization.
    pub fn new(
        service: Arc<S>,
        entity_access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access,
            authorization,
        }
    }
}

impl<S, Access, Auth> Clone for AgentFeedbackRouterState<S, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            entity_access: Arc::clone(&self.entity_access),
            authorization: self.authorization.clone(),
        }
    }
}

impl<S, Access, Auth> FromRef<AgentFeedbackRouterState<S, Access, Auth>> for Arc<Access> {
    fn from_ref(state: &AgentFeedbackRouterState<S, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

impl<S, Access, Auth> FromRef<AgentFeedbackRouterState<S, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentFeedbackRouterState<S, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// The feedback routes.
pub fn agent_feedback_router<S, Access, Auth, St>(
    state: AgentFeedbackRouterState<S, Access, Auth>,
) -> Router<St>
where
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/agent-feedback/agent-sessions/{session_id}/turns/{turn}",
            put(rate_turn::<S, Access, Auth>).delete(retract_turn::<S, Access, Auth>),
        )
        .route(
            "/agent-feedback/agent-sessions/{session_id}/mine",
            get(my_turn_feedback::<S, Access, Auth>),
        )
        .route(
            "/agent-feedback/messages/{parent_type}/{parent_id}/items/{message_id}",
            put(rate_message::<S, Access, Auth>).delete(retract_message::<S, Access, Auth>),
        )
        .route(
            "/agent-feedback/messages/{parent_type}/{parent_id}/mine",
            get(my_message_feedback::<S, Access, Auth>),
        )
        .route(
            "/agent-feedback/routines/{id}/runs/{run_id}",
            put(rate_run::<S, Access, Auth>).delete(retract_run::<S, Access, Auth>),
        )
        .route(
            "/agent-feedback/routines/{id}/mine",
            get(my_run_feedback::<S, Access, Auth>),
        )
        .route(
            "/internal/agent-feedback/events",
            get(export_feedback::<S, Access, Auth>),
        )
        .with_state(state)
}

/// A rating, or a change to one.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RateFeedbackBody {
    /// A UUIDv7 the client mints per action and sends again on retry.
    pub id: Uuid,
    /// Up or down.
    pub rating: Rating,
    /// An optional note, at most 4000 characters; empty means none.
    #[serde(default)]
    pub note: Option<String>,
    /// Where the response was seen.
    pub surface: Surface,
}

/// A retraction.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct RetractFeedbackQuery {
    /// A UUIDv7 the client mints per action and sends again on retry.
    pub id: Uuid,
    /// Where the response was seen.
    pub surface: Surface,
}

/// The caller's current ratings in one container.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MyFeedbackResponse {
    /// One per rated response; retracted ratings are left out.
    pub items: Vec<MyFeedback>,
}

/// Where an export page starts and how long it is.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ExportFeedbackQuery {
    /// The previous page's `next.afterCreatedAt`; with `afterId`.
    pub after_created_at: Option<DateTime<Utc>>,
    /// The previous page's `next.afterId`; with `afterCreatedAt`.
    pub after_id: Option<Uuid>,
    /// Rows per page, 1 to 1000; 500 when absent.
    pub limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TurnPath {
    turn: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MessagePath {
    parent_type: String,
    parent_id: String,
    message_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ParentPath {
    parent_type: String,
    parent_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunPath {
    run_id: Uuid,
}

/// A failed feedback request's body.
#[derive(Debug, Serialize, ToSchema)]
pub struct FeedbackErrorBody {
    /// What went wrong.
    pub message: String,
    /// A stable code for refusals a client handles: `subject_not_in_container`,
    /// `not_agent_authored`, `id_taken`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
}

/// A feedback request's failure, as an HTTP answer.
#[derive(Debug)]
pub enum FeedbackHttpError {
    /// The body didn't parse.
    InvalidBody(JsonRejection),
    /// The service refused or failed.
    Service(FeedbackError),
}

impl From<FeedbackError> for FeedbackHttpError {
    fn from(error: FeedbackError) -> Self {
        Self::Service(error)
    }
}

impl IntoResponse for FeedbackHttpError {
    fn into_response(self) -> Response {
        let error = match self {
            Self::InvalidBody(rejection) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(FeedbackErrorBody {
                        message: rejection.body_text(),
                        code: None,
                    }),
                )
                    .into_response();
            }
            Self::Service(error) => error,
        };
        let (status, code) = match &error {
            FeedbackError::NotFound => (StatusCode::NOT_FOUND, None),
            FeedbackError::Forbidden => (StatusCode::FORBIDDEN, None),
            FeedbackError::SubjectNotInContainer => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Some("subject_not_in_container"),
            ),
            FeedbackError::NotAgentAuthored => {
                (StatusCode::UNPROCESSABLE_ENTITY, Some("not_agent_authored"))
            }
            FeedbackError::Invalid(_) => (StatusCode::BAD_REQUEST, None),
            FeedbackError::IdTaken => (StatusCode::CONFLICT, Some("id_taken")),
            FeedbackError::Unavailable(cause) => {
                tracing::error!(error = ?cause, "agent feedback request failed");
                (StatusCode::SERVICE_UNAVAILABLE, None)
            }
        };
        (
            status,
            Json(FeedbackErrorBody {
                message: error.to_string(),
                code,
            }),
        )
            .into_response()
    }
}

/// View access to a message parent's messages, minted for the caller.
async fn parent_access<Access: EntityAccessService>(
    access: &Access,
    user: &macro_authorization::MacroUserAuthentication,
    parent: &MessageParent,
) -> Result<EntityAccessReceipt<MessageView>, FeedbackHttpError> {
    principal_entity_access_receipt::<MessageView>(
        access,
        &MacroAuthorization::User(user.clone()),
        &parent.entity_id(),
        parent.access_entity_type(),
    )
    .await
    .map_err(|error| match error {
        AccessError::Unavailable(cause) | AccessError::Internal(cause) => {
            FeedbackError::Unavailable(cause).into()
        }
        AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::BadRequest(_)
        | AccessError::NotFound(_) => FeedbackError::Forbidden.into(),
    })
}

fn parse_parent(parent_type: &str, parent_id: &str) -> Result<MessageParent, FeedbackHttpError> {
    MessageParent::parse(parent_type, parent_id)
        .map_err(|_| FeedbackError::Invalid("invalid message parent").into())
}

fn rate_request(
    body: Result<Json<RateFeedbackBody>, JsonRejection>,
) -> Result<RateRequest, FeedbackHttpError> {
    let Json(body) = body.map_err(FeedbackHttpError::InvalidBody)?;
    Ok(RateRequest {
        id: body.id,
        rating: body.rating,
        note: body.note,
        surface: body.surface,
        trace_id: macro_tower_layers::current_trace_id(),
    })
}

fn retract_request(query: RetractFeedbackQuery) -> RetractRequest {
    RetractRequest {
        id: query.id,
        surface: query.surface,
        trace_id: macro_tower_layers::current_trace_id(),
    }
}

/// Rate the agent's reply in one turn of a session.
#[utoipa::path(
    put,
    path = "/agent-feedback/agent-sessions/{session_id}/turns/{turn}",
    operation_id = "agent_feedback_rate_turn",
    tag = "agent_feedback",
    params(("session_id" = Uuid, Path), ("turn" = u32, Path)),
    request_body = RateFeedbackBody,
    responses(
        (status = 200, body = FeedbackState),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn rate_turn<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    session: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    Path(path): Path<TurnPath>,
    body: Result<Json<RateFeedbackBody>, JsonRejection>,
) -> Result<Json<FeedbackState>, FeedbackHttpError> {
    let request = rate_request(body)?;
    let response = RatedResponse::AgentSessionTurn {
        session: session.entity_access_receipt,
        turn: path.turn,
    };
    Ok(Json(state.service.rate(response, request).await?))
}

/// Retract the caller's rating of the agent's reply in one turn.
#[utoipa::path(
    delete,
    path = "/agent-feedback/agent-sessions/{session_id}/turns/{turn}",
    operation_id = "agent_feedback_retract_turn",
    tag = "agent_feedback",
    params(("session_id" = Uuid, Path), ("turn" = u32, Path), RetractFeedbackQuery),
    responses(
        (status = 204),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn retract_turn<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    session: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    Path(path): Path<TurnPath>,
    Query(query): Query<RetractFeedbackQuery>,
) -> Result<StatusCode, FeedbackHttpError> {
    let response = RatedResponse::AgentSessionTurn {
        session: session.entity_access_receipt,
        turn: path.turn,
    };
    state
        .service
        .retract(response, retract_request(query))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The caller's current ratings of a session's replies.
#[utoipa::path(
    get,
    path = "/agent-feedback/agent-sessions/{session_id}/mine",
    operation_id = "agent_feedback_my_turn_feedback",
    tag = "agent_feedback",
    params(("session_id" = Uuid, Path)),
    responses(
        (status = 200, body = MyFeedbackResponse),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn my_turn_feedback<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    session: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
) -> Result<Json<MyFeedbackResponse>, FeedbackHttpError> {
    let items = state
        .service
        .mine(FeedbackContainer::AgentSession(
            session.entity_access_receipt,
        ))
        .await?;
    Ok(Json(MyFeedbackResponse { items }))
}

/// Rate an agent's message in a channel, DM, thread or discussion.
#[utoipa::path(
    put,
    path = "/agent-feedback/messages/{parent_type}/{parent_id}/items/{message_id}",
    operation_id = "agent_feedback_rate_message",
    tag = "agent_feedback",
    params(
        ("parent_type" = String, Path),
        ("parent_id" = String, Path),
        ("message_id" = Uuid, Path),
    ),
    request_body = RateFeedbackBody,
    responses(
        (status = 200, body = FeedbackState),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403, body = FeedbackErrorBody),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 422, body = FeedbackErrorBody, description = "Not an agent's message in this parent"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn rate_message<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<MessagePath>,
    body: Result<Json<RateFeedbackBody>, JsonRejection>,
) -> Result<Json<FeedbackState>, FeedbackHttpError> {
    let parent = parse_parent(&path.parent_type, &path.parent_id)?;
    let access = parent_access(state.entity_access.as_ref(), &user.authorization, &parent).await?;
    let request = rate_request(body)?;
    let response = RatedResponse::Message {
        parent,
        access,
        message_id: path.message_id,
    };
    Ok(Json(state.service.rate(response, request).await?))
}

/// Retract the caller's rating of an agent's message.
#[utoipa::path(
    delete,
    path = "/agent-feedback/messages/{parent_type}/{parent_id}/items/{message_id}",
    operation_id = "agent_feedback_retract_message",
    tag = "agent_feedback",
    params(
        ("parent_type" = String, Path),
        ("parent_id" = String, Path),
        ("message_id" = Uuid, Path),
        RetractFeedbackQuery,
    ),
    responses(
        (status = 204),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403, body = FeedbackErrorBody),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 422, body = FeedbackErrorBody, description = "Not an agent's message in this parent"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn retract_message<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<MessagePath>,
    Query(query): Query<RetractFeedbackQuery>,
) -> Result<StatusCode, FeedbackHttpError> {
    let parent = parse_parent(&path.parent_type, &path.parent_id)?;
    let access = parent_access(state.entity_access.as_ref(), &user.authorization, &parent).await?;
    let response = RatedResponse::Message {
        parent,
        access,
        message_id: path.message_id,
    };
    state
        .service
        .retract(response, retract_request(query))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The caller's current ratings of agents' messages on one parent.
#[utoipa::path(
    get,
    path = "/agent-feedback/messages/{parent_type}/{parent_id}/mine",
    operation_id = "agent_feedback_my_message_feedback",
    tag = "agent_feedback",
    params(("parent_type" = String, Path), ("parent_id" = String, Path)),
    responses(
        (status = 200, body = MyFeedbackResponse),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403, body = FeedbackErrorBody),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn my_message_feedback<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<ParentPath>,
) -> Result<Json<MyFeedbackResponse>, FeedbackHttpError> {
    let parent = parse_parent(&path.parent_type, &path.parent_id)?;
    let access = parent_access(state.entity_access.as_ref(), &user.authorization, &parent).await?;
    let items = state
        .service
        .mine(FeedbackContainer::MessageParent { parent, access })
        .await?;
    Ok(Json(MyFeedbackResponse { items }))
}

/// Rate one run of a routine.
#[utoipa::path(
    put,
    path = "/agent-feedback/routines/{id}/runs/{run_id}",
    operation_id = "agent_feedback_rate_run",
    tag = "agent_feedback",
    params(("id" = Uuid, Path), ("run_id" = Uuid, Path)),
    request_body = RateFeedbackBody,
    responses(
        (status = 200, body = FeedbackState),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 422, body = FeedbackErrorBody, description = "Not a run of this routine"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn rate_run<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    routine: ScheduledActionAccessExtractor<ViewAccessLevel, Access, Auth>,
    Path(path): Path<RunPath>,
    body: Result<Json<RateFeedbackBody>, JsonRejection>,
) -> Result<Json<FeedbackState>, FeedbackHttpError> {
    let request = rate_request(body)?;
    let response = RatedResponse::RoutineRun {
        routine: routine.entity_access_receipt,
        run_id: path.run_id,
    };
    Ok(Json(state.service.rate(response, request).await?))
}

/// Retract the caller's rating of a routine run.
#[utoipa::path(
    delete,
    path = "/agent-feedback/routines/{id}/runs/{run_id}",
    operation_id = "agent_feedback_retract_run",
    tag = "agent_feedback",
    params(("id" = Uuid, Path), ("run_id" = Uuid, Path), RetractFeedbackQuery),
    responses(
        (status = 204),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 409, body = FeedbackErrorBody),
        (status = 422, body = FeedbackErrorBody, description = "Not a run of this routine"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn retract_run<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    routine: ScheduledActionAccessExtractor<ViewAccessLevel, Access, Auth>,
    Path(path): Path<RunPath>,
    Query(query): Query<RetractFeedbackQuery>,
) -> Result<StatusCode, FeedbackHttpError> {
    let response = RatedResponse::RoutineRun {
        routine: routine.entity_access_receipt,
        run_id: path.run_id,
    };
    state
        .service
        .retract(response, retract_request(query))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The caller's current ratings of a routine's runs.
#[utoipa::path(
    get,
    path = "/agent-feedback/routines/{id}/mine",
    operation_id = "agent_feedback_my_run_feedback",
    tag = "agent_feedback",
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, body = MyFeedbackResponse),
        (status = 401), (status = 403),
        (status = 404, description = "Agent feedback is off for the caller"),
        (status = 503, body = FeedbackErrorBody),
    ),
    security(("bearerAuth" = []))
)]
pub(crate) async fn my_run_feedback<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOnly>,
    routine: ScheduledActionAccessExtractor<ViewAccessLevel, Access, Auth>,
) -> Result<Json<MyFeedbackResponse>, FeedbackHttpError> {
    let items = state
        .service
        .mine(FeedbackContainer::Routine(routine.entity_access_receipt))
        .await?;
    Ok(Json(MyFeedbackResponse { items }))
}

/// Every stored rating, change and retraction in `(createdAt, id)` order, a
/// page at a time, for evals. Internal API key only.
#[utoipa::path(
    get,
    path = "/internal/agent-feedback/events",
    operation_id = "agent_feedback_export_events",
    tag = "agent_feedback",
    params(ExportFeedbackQuery),
    responses(
        (status = 200, body = ExportPage),
        (status = 400, body = FeedbackErrorBody),
        (status = 401), (status = 403),
        (status = 503, body = FeedbackErrorBody),
    )
)]
pub(crate) async fn export_feedback<
    S: FeedbackApi,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<AgentFeedbackRouterState<S, Access, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Query(query): Query<ExportFeedbackQuery>,
) -> Result<Json<ExportPage>, FeedbackHttpError> {
    let after = match (query.after_created_at, query.after_id) {
        (None, None) => None,
        (Some(after_created_at), Some(after_id)) => Some(ExportCursor {
            after_created_at,
            after_id,
        }),
        _ => {
            return Err(FeedbackError::Invalid("afterCreatedAt and afterId go together").into());
        }
    };
    let limit = match query.limit {
        Some(limit) => ExportLimit::new(limit)?,
        None => ExportLimit::DEFAULT,
    };
    Ok(Json(state.service.export(after, limit).await?))
}
