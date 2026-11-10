//! Build a stored HTML document and run its programs as the signed-in user.
use crate::domain::{
    BuildOutcome, CodeModeError, DocumentBuild, DocumentProgramError, DocumentProgramGate,
    DocumentPrograms, DocumentSourceError, ProgramId, RunProgram, SourceHash, UserExecutionReceipt,
};
use crate::inbound::axum_router::CodeExecutionApiError;
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use code_execution::domain::Diagnostic;
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
    is_agent_run,
};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use utoipa::ToSchema;

/// Dependencies for document builds and program runs.
pub struct DocumentProgramRouterState<Access, Auth> {
    service: Arc<DocumentPrograms>,
    gate: Arc<dyn DocumentProgramGate>,
    access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Access, Auth> DocumentProgramRouterState<Access, Auth> {
    /// Bind the document service, its rollout gate and the access boundary.
    pub fn new(
        service: Arc<DocumentPrograms>,
        gate: Arc<dyn DocumentProgramGate>,
        access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            gate,
            access,
            authorization,
        }
    }
}

impl<Access, Auth> Clone for DocumentProgramRouterState<Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            gate: self.gate.clone(),
            access: self.access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Access, Auth> FromRef<DocumentProgramRouterState<Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &DocumentProgramRouterState<Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at the service root; paths are `/documents/{document_id}/...`.
pub fn document_program_router<Access, Auth>(
    state: DocumentProgramRouterState<Access, Auth>,
) -> Router
where
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/documents/{document_id}/build",
            get(get_document_build::<Access, Auth>),
        )
        .route(
            "/documents/{document_id}/code-executions",
            post(run_document_program::<Access, Auth>),
        )
        .with_state(state)
}

/// A document's build: the page to render, or why it doesn't build.
#[derive(Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DocumentBuildResponse {
    /// The page, with its programs removed and its client script bundled.
    #[serde(rename_all = "camelCase")]
    Built {
        /// Send with each run, so a run never uses a newer build than the page.
        #[schema(value_type = String)]
        source_hash: SourceHash,
        /// The page to render in the sandboxed preview.
        html: String,
        /// The ids of the programs the page may run.
        #[schema(value_type = Vec<String>)]
        programs: Vec<ProgramId>,
    },
    /// The author's problems, by block.
    #[serde(rename_all = "camelCase")]
    Failed {
        /// The source this verdict is for.
        #[schema(value_type = String)]
        source_hash: SourceHash,
        /// Each problem, with where it is.
        diagnostics: Vec<BuildProblem>,
    },
}

/// One problem in a document's source.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildProblem {
    /// The block it is in, such as `program tasks` or `client script`.
    pub file: Option<String>,
    /// What is wrong, with its location.
    pub message: String,
}

impl From<DocumentBuild> for DocumentBuildResponse {
    fn from(build: DocumentBuild) -> Self {
        match build.outcome.as_ref() {
            BuildOutcome::Built { html, programs } => Self::Built {
                source_hash: build.source_hash,
                html: html.clone(),
                programs: programs.keys().cloned().collect(),
            },
            BuildOutcome::Failed(diagnostics) => Self::Failed {
                source_hash: build.source_hash,
                diagnostics: diagnostics.iter().map(BuildProblem::from).collect(),
            },
        }
    }
}

impl From<&Diagnostic> for BuildProblem {
    fn from(diagnostic: &Diagnostic) -> Self {
        Self {
            file: diagnostic.file.clone(),
            message: diagnostic.message.clone(),
        }
    }
}

/// Run one program of the build a page shows.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunDocumentProgram {
    /// `sourceHash` of the build the page was rendered from.
    #[schema(value_type = String)]
    pub source_hash: SourceHash,
    /// The program's id: its block's `id`.
    #[schema(value_type = String)]
    pub program: ProgramId,
    /// The program's first argument.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    /// Total deadline in milliseconds, from 1 to 30000.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_timeout_ms() -> u64 {
    30_000
}

/// [`DocumentProgramError`] as an HTTP response.
#[derive(Debug)]
pub struct DocumentProgramApiError(DocumentProgramError);

impl From<DocumentProgramError> for DocumentProgramApiError {
    fn from(error: DocumentProgramError) -> Self {
        Self(error)
    }
}

impl IntoResponse for DocumentProgramApiError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        let status = match self.0 {
            DocumentProgramError::Source(DocumentSourceError::NotFound)
            | DocumentProgramError::UnknownProgram => StatusCode::NOT_FOUND,
            DocumentProgramError::Source(DocumentSourceError::NotHtml)
            | DocumentProgramError::BuildFailed => StatusCode::UNPROCESSABLE_ENTITY,
            DocumentProgramError::Source(DocumentSourceError::TooLarge) => {
                StatusCode::PAYLOAD_TOO_LARGE
            }
            DocumentProgramError::Changed => StatusCode::CONFLICT,
            DocumentProgramError::Busy => StatusCode::SERVICE_UNAVAILABLE,
            DocumentProgramError::Execution(error) => {
                return CodeExecutionApiError(error).into_response();
            }
            DocumentProgramError::Source(DocumentSourceError::Internal(_))
            | DocumentProgramError::Toolchain => {
                tracing::error!(error = ?self.0, "document program failed");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "could not build the document",
                )
                    .into_response();
            }
        };
        (status, message).into_response()
    }
}

/// The signed-in user, admitted by the rollout, with view access to the
/// document. An agent's token may build a page it published, but only
/// [`run_document_program`] runs anything.
async fn admit<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    caller: &MacroAuthorizationExtractor<Auth, UserOnly>,
    state: &DocumentProgramRouterState<Access, Auth>,
    document_id: Uuid,
) -> Result<EntityAccessReceipt<ViewAccessLevel>, DocumentProgramApiError> {
    let user = &caller.authorization.macro_user_id;
    if !state.gate.allows(user).await {
        return Err(DocumentProgramApiError(CodeModeError::NotFound.into()));
    }
    state
        .access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            user,
            None,
            &document_id.to_string(),
            EntityType::Document,
        )
        .await
        .map_err(|error| match error {
            // A document the user can't see answers like one that doesn't exist.
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_)
            | AccessError::BadRequest(_) => {
                DocumentProgramApiError(DocumentSourceError::NotFound.into())
            }
            AccessError::Unavailable(_) => DocumentProgramApiError(DocumentProgramError::Busy),
            AccessError::Internal(report) => {
                DocumentProgramApiError(DocumentSourceError::Internal(report).into())
            }
        })
}

/// Only a person in the app starts a run: a token minted for an agent's run,
/// or any program's request (a document program's token carries no agent),
/// may not start another run through here.
fn refuse_program_caller(
    agent_attributed: bool,
    headers: &HeaderMap,
) -> Result<(), DocumentProgramApiError> {
    if is_agent_run(agent_attributed, headers) {
        return Err(DocumentProgramApiError(CodeModeError::Forbidden.into()));
    }
    Ok(())
}

#[utoipa::path(get, path = "/documents/{document_id}/build", tag = "documents", operation_id = "get_document_build",
    params(("document_id" = Uuid, Path, description = "A stored HTML document")),
    responses((status = 200, body = DocumentBuildResponse), (status = 401), (status = 403), (status = 404), (status = 413), (status = 422), (status = 500), (status = 503)))]
/// Build the document's current source, or return the cached build, for the
/// preview to render.
#[tracing::instrument(err(Debug), skip_all, fields(%document_id))]
pub async fn get_document_build<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    caller: MacroAuthorizationExtractor<Auth, UserOnly>,
    State(state): State<DocumentProgramRouterState<Access, Auth>>,
    Path(document_id): Path<Uuid>,
) -> Result<Json<DocumentBuildResponse>, DocumentProgramApiError> {
    let document = admit(&caller, &state, document_id).await?;
    let build = state.service.build(&document).await?;
    Ok(Json(build.into()))
}

#[utoipa::path(post, path = "/documents/{document_id}/code-executions", tag = "documents", operation_id = "run_document_program",
    params(("document_id" = Uuid, Path, description = "The document the program is in")),
    request_body = RunDocumentProgram,
    responses((status = 200, body = UserExecutionReceipt), (status = 400), (status = 401), (status = 403), (status = 404), (status = 409), (status = 422), (status = 500), (status = 503)))]
/// Run one program of the document's build as the signed-in user and return
/// its outcome. `409` means the document changed since the page was built.
#[tracing::instrument(err(Debug), skip_all, fields(%document_id))]
pub async fn run_document_program<Access: EntityAccessService, Auth: MacroAuthorizationService>(
    caller: MacroAuthorizationExtractor<Auth, UserOnly>,
    State(state): State<DocumentProgramRouterState<Access, Auth>>,
    Path(document_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<RunDocumentProgram>,
) -> Result<Json<UserExecutionReceipt>, DocumentProgramApiError> {
    refuse_program_caller(caller.authorization.agent_id.is_some(), &headers)?;
    let document = admit(&caller, &state, document_id).await?;
    let receipt = state
        .service
        .run(
            &caller.authorization.macro_user_id,
            &document,
            RunProgram {
                source_hash: body.source_hash,
                program: body.program,
                arguments: body.arguments,
                timeout_ms: body.timeout_ms,
            },
            CancellationToken::new(),
        )
        .await?;
    Ok(Json(receipt))
}

#[cfg(test)]
mod test;
