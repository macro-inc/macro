//! Session-authorized reads for code execution's existing tool components.
use crate::domain::{CodeModeError, ExecutionId, ExecutionRecord, SessionCodeMode};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::AgentSessionAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use std::sync::Arc;

/// Dependencies for the read-only browser API.
pub struct CodeExecutionRouterState<Access, Auth> {
    service: Arc<dyn SessionCodeMode>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Access, Auth> CodeExecutionRouterState<Access, Auth> {
    /// Bind the service and the standard session access boundary.
    pub fn new(
        service: Arc<dyn SessionCodeMode>,
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

impl<Access, Auth> Clone for CodeExecutionRouterState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
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
