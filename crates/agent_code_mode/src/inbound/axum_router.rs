//! Session-authorized reads for code execution's existing tool components.
use crate::domain::{
    CodeModeError, ExecutionId, ExecutionRecord, SessionCodeMode, connected_apps::*, reviews::*,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::{
    domain::{
        models::{EditAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOnly,
};
use macro_uuid::Uuid;
use std::sync::Arc;

/// Dependencies for the read-only browser API.
pub struct CodeExecutionRouterState<Access, Auth> {
    service: Arc<dyn SessionCodeMode>,
    reviews: ReviewService,
    connected_apps: ConnectedAppService,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Access, Auth> CodeExecutionRouterState<Access, Auth> {
    /// Bind the service and the standard session access boundary.
    pub fn new(
        service: Arc<dyn SessionCodeMode>,
        reviews: ReviewService,
        connected_apps: ConnectedAppService,
        entity_access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            reviews,
            connected_apps,
            entity_access,
            authorization,
        }
    }
}

impl<Access, Auth> Clone for CodeExecutionRouterState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            reviews: self.reviews.clone(),
            connected_apps: self.connected_apps.clone(),
            entity_access: self.entity_access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Access, Auth> FromRef<CodeExecutionRouterState<Access, Auth>> for Arc<Access> {
    fn from_ref(state: &CodeExecutionRouterState<Access, Auth>) -> Self {
        state.entity_access.clone()
    }
}

impl<Access, Auth> FromRef<CodeExecutionRouterState<Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &CodeExecutionRouterState<Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount next to the existing `/agent-sessions` routes.
pub fn code_execution_router<Access, Auth>(state: CodeExecutionRouterState<Access, Auth>) -> Router
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/{session_id}/code-executions/{execution_id}",
            get(get_code_execution::<Access, Auth>),
        )
        .route("/{session_id}/reviews", post(create_review::<Access, Auth>))
        .route("/{session_id}/views", post(present_view::<Access, Auth>))
        .route(
            "/{session_id}/reviews/{review_id}",
            get(get_review::<Access, Auth>).post(decide_review::<Access, Auth>),
        )
        .route(
            "/{session_id}/code-executions/{execution_id}/reviews",
            get(list_reviews::<Access, Auth>),
        )
        .route(
            "/{session_id}/code-executions/{execution_id}/connected-apps",
            get(list_connected_apps::<Access, Auth>),
        )
        .route(
            "/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/tools",
            get(list_connected_app_tools::<Access, Auth>),
        )
        .route(
            "/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/calls",
            post(call_connected_app_tool::<Access, Auth>),
        )
        .with_state(state)
}

/// Map domain failures without exposing infrastructure details.
pub struct CodeExecutionApiError(CodeModeError);

impl IntoResponse for CodeExecutionApiError {
    fn into_response(self) -> Response {
        match self.0 {
            CodeModeError::Forbidden => (StatusCode::FORBIDDEN, "forbidden").into_response(),
            CodeModeError::NotFound => {
                (StatusCode::NOT_FOUND, "code execution not found").into_response()
            }
            CodeModeError::Conflict => {
                (StatusCode::CONFLICT, "review changed; reload before acting").into_response()
            }
            CodeModeError::Invalid(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            error => {
                tracing::error!(error = ?error, "code execution read failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "could not read code execution",
                )
                    .into_response()
            }
        }
    }
}

#[utoipa::path(get, path = "/agent-sessions/{session_id}/code-executions/{execution_id}", tag = "agent-sessions", operation_id = "get_code_execution",
    params(("session_id" = Uuid, Path, description = "Owning session"), ("execution_id" = Uuid, Path, description = "Execution receipt identity")),
    responses((status = 200, body = ExecutionRecord), (status = 401), (status = 403), (status = 404), (status = 500)))]
/// Fetch one execution only after the caller has obtained view access to its session.
pub async fn get_code_execution<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, execution)): Path<(Uuid, Uuid)>,
) -> Result<Json<ExecutionRecord>, CodeExecutionApiError> {
    state
        .service
        .read(
            &access.entity_access_receipt,
            ExecutionId::from_uuid(execution),
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}

#[utoipa::path(post, path = "/agent-sessions/{session_id}/reviews", tag = "agent-sessions", operation_id = "create_session_review", params(("session_id" = Uuid, Path)), request_body = CreateReview, responses((status = 200, body = ReviewRecord), (status = 403), (status = 400)))]
/// Persist a review without keeping the agent turn blocked.
pub async fn create_review<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    body: Bytes,
) -> Result<Json<ReviewRecord>, CodeExecutionApiError> {
    let input: CreateReview = decode(&body).map_err(CodeExecutionApiError)?;
    state
        .reviews
        .create(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
            input,
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/views", tag = "agent-sessions", operation_id = "present_session_view", params(("session_id" = Uuid, Path)), request_body = PresentView, responses((status = 204), (status = 403), (status = 400)))]
/// Present a view in the session: a review with nothing saved.
pub async fn present_view<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Json(input): Json<PresentView>,
) -> Result<StatusCode, CodeExecutionApiError> {
    state
        .reviews
        .present_view(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
            input,
        )
        .await
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(CodeExecutionApiError)
}
#[utoipa::path(get, path = "/agent-sessions/{session_id}/reviews/{review_id}", tag = "agent-sessions", operation_id = "get_session_review", params(("session_id" = Uuid, Path), ("review_id" = Uuid, Path)), responses((status = 200, body = ReviewRecord), (status = 403), (status = 404)))]
/// Read a persisted interactive block.
pub async fn get_review<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ReviewRecord>, CodeExecutionApiError> {
    state
        .reviews
        .read(&access.entity_access_receipt, ReviewId(id))
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}
#[utoipa::path(get, path = "/agent-sessions/{session_id}/code-executions/{execution_id}/reviews", tag = "agent-sessions", operation_id = "list_execution_reviews", params(("session_id" = Uuid, Path), ("execution_id" = Uuid, Path)), responses((status = 200, body = Vec<ReviewRecord>), (status = 403)))]
/// List blocks created during an execution, including interrupted executions.
pub async fn list_reviews<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ReviewRecord>>, CodeExecutionApiError> {
    state
        .reviews
        .list(&access.entity_access_receipt, ExecutionId::from_uuid(id))
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}
#[utoipa::path(post, path = "/agent-sessions/{session_id}/reviews/{review_id}", tag = "agent-sessions", operation_id = "decide_session_review", params(("session_id" = Uuid, Path), ("review_id" = Uuid, Path)), request_body = ReviewDecision, responses((status = 200, body = ReviewRecord), (status = 403), (status = 409)))]
/// Save edits or atomically claim the exact draft revision the user submitted.
pub async fn decide_review<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, UserOnly>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, id)): Path<(Uuid, Uuid)>,
    body: Bytes,
) -> Result<Json<ReviewRecord>, CodeExecutionApiError> {
    let decision: ReviewDecision = decode(&body).map_err(CodeExecutionApiError)?;
    state
        .reviews
        .decide(
            &access.entity_access_receipt,
            &caller.authorization.macro_user_id,
            ReviewId(id),
            decision,
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}

#[utoipa::path(get, path = "/agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps", tag = "agent-sessions", operation_id = "list_execution_connected_apps",
    params(("session_id" = Uuid, Path), ("execution_id" = Uuid, Path, description = "A running execution of the session's current turn")),
    responses((status = 200, body = Vec<ConnectedApp>), (status = 403), (status = 404)))]
/// List the connected apps and custom MCP servers the session's agent may use.
pub async fn list_connected_apps<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, execution)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ConnectedApp>>, CodeExecutionApiError> {
    state
        .connected_apps
        .apps(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
            ExecutionId::from_uuid(execution),
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}

#[utoipa::path(get, path = "/agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/tools", tag = "agent-sessions", operation_id = "list_connected_app_tools",
    params(("session_id" = Uuid, Path), ("execution_id" = Uuid, Path), ("kind" = ConnectedAppKind, Path), ("key" = String, Path, description = "The app's slug or custom server key")),
    responses((status = 200, body = Vec<ConnectedTool>), (status = 403), (status = 404)))]
/// List the tools one connected app serves.
pub async fn list_connected_app_tools<
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, execution, kind, key)): Path<(Uuid, Uuid, ConnectedAppKind, String)>,
) -> Result<Json<Vec<ConnectedTool>>, CodeExecutionApiError> {
    state
        .connected_apps
        .tools(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
            ExecutionId::from_uuid(execution),
            ConnectedAppRef { kind, key },
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}

#[utoipa::path(post, path = "/agent-sessions/{session_id}/code-executions/{execution_id}/connected-apps/{kind}/{key}/calls", tag = "agent-sessions", operation_id = "call_connected_app_tool",
    params(("session_id" = Uuid, Path), ("execution_id" = Uuid, Path), ("kind" = ConnectedAppKind, Path), ("key" = String, Path, description = "The app's slug or custom server key")),
    request_body = CallConnectedTool,
    responses((status = 200, body = ConnectedToolResult), (status = 400), (status = 403), (status = 404)))]
/// Call one tool of a connected app as the execution's account.
pub async fn call_connected_app_tool<
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<CodeExecutionRouterState<Access, Auth>>,
    Path((_session, execution, kind, key)): Path<(Uuid, Uuid, ConnectedAppKind, String)>,
    body: Bytes,
) -> Result<Json<ConnectedToolResult>, CodeExecutionApiError> {
    let call: CallConnectedTool = decode(&body).map_err(CodeExecutionApiError)?;
    state
        .connected_apps
        .call(
            &access.entity_access_receipt,
            &caller.authorization.user.macro_user_id,
            ExecutionId::from_uuid(execution),
            ConnectedAppRef { kind, key },
            call,
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}
