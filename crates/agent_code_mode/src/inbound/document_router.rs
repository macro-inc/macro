//! Run a document's embedded program as the signed-in user.
use crate::domain::{CodeModeError, DocumentProgramGate, UserCodeMode, UserExecutionReceipt};
use crate::inbound::axum_router::CodeExecutionApiError;
use ai_toolset::ToolCaller;
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    routing::post,
};
use code_execution::domain::{ExecuteRequest, Unattended};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::Deserialize;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use utoipa::ToSchema;

/// Dependencies for document program runs.
pub struct DocumentProgramRouterState<Auth> {
    service: Arc<dyn UserCodeMode>,
    gate: Arc<dyn DocumentProgramGate>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Auth> DocumentProgramRouterState<Auth> {
    /// Bind the user-scoped runner, its rollout gate and the authorization boundary.
    pub fn new(
        service: Arc<dyn UserCodeMode>,
        gate: Arc<dyn DocumentProgramGate>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            gate,
            authorization,
        }
    }
}

impl<Auth> Clone for DocumentProgramRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            gate: self.gate.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Auth> FromRef<DocumentProgramRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DocumentProgramRouterState<Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at the service root; paths are `/documents/{document_id}/...`.
pub fn document_program_router<Auth>(state: DocumentProgramRouterState<Auth>) -> Router
where
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/documents/{document_id}/code-executions",
            post(run_document_program::<Auth>),
        )
        .with_state(state)
}

/// A program taken from the open document, with the inputs its caller passed.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunDocumentProgram {
    /// TypeScript module exporting `async function main({macro, ...arguments})`,
    /// at most 64 KiB.
    pub source: String,
    /// Spread into `main`'s argument beside `macro`.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    /// Total deadline in milliseconds, from 1 to 30000.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    /// Send no writes: each one returns an empty result and is reported as
    /// skipped, so the run shows what the program would change.
    #[serde(default)]
    pub dry_run: bool,
}

fn default_timeout_ms() -> u64 {
    30_000
}

#[utoipa::path(post, path = "/documents/{document_id}/code-executions", tag = "documents", operation_id = "run_document_program",
    params(("document_id" = Uuid, Path, description = "The document the program is embedded in")),
    request_body = RunDocumentProgram,
    responses((status = 200, body = UserExecutionReceipt), (status = 400), (status = 401), (status = 403), (status = 404), (status = 500)))]
/// Run a program from the document the user has open, as that user, and
/// return its outcome. Only directly signed-in users: a token minted for an
/// agent's run may not start another run through here.
#[tracing::instrument(err(Debug), skip_all, fields(%document_id))]
pub async fn run_document_program<Auth: MacroAuthorizationService>(
    caller: MacroAuthorizationExtractor<Auth, UserOnly>,
    State(state): State<DocumentProgramRouterState<Auth>>,
    Path(document_id): Path<Uuid>,
    Json(body): Json<RunDocumentProgram>,
) -> Result<Json<UserExecutionReceipt>, CodeExecutionApiError> {
    let user = &caller.authorization.macro_user_id;
    if caller.authorization.agent_id.is_some() {
        return Err(CodeExecutionApiError(CodeModeError::Forbidden));
    }
    if !state.gate.allows(user).await {
        return Err(CodeExecutionApiError(CodeModeError::NotFound));
    }
    state
        .service
        .execute(
            user,
            &ToolCaller::Document,
            None,
            ExecuteRequest {
                source: body.source,
                timeout_ms: body.timeout_ms,
            },
            Some(Unattended {
                arguments: body.arguments,
                dry_run: body.dry_run,
            }),
            CancellationToken::new(),
        )
        .await
        .map(Json)
        .map_err(CodeExecutionApiError)
}
