//! Axum routes serving a session's changes, mounted under `/agent-sessions`.
//!
//! Every route authenticates its caller and resolves their grant on the
//! session with [`AgentSessionAccessLevelExtractor`] before the handler body
//! runs: reading the summary or the patch needs `View`; asking for a fresh
//! capture needs `Edit`, the same bar as prompting
//! the agent. Handlers map DTOs to the domain and call one service method;
//! the receipt travels into the domain so the service can prove the check
//! happened.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::error::ChangesError;
use crate::domain::model::{
    AttemptOutcome, CaptureAttempt, ChangedFile, Changeset, ChangesetSource, FileChangeKind,
    GitRef, SessionChanges,
};
use crate::domain::service::AgentChanges;

#[cfg(test)]
mod test;

/// Shared state for the changes router: the service plus what the access
/// extractors resolve grants and identity through.
pub struct AgentChangesRouterState<Changes, Access, Auth> {
    service: Arc<Changes>,
    entity_access: Arc<Access>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Changes, Access, Auth> AgentChangesRouterState<Changes, Access, Auth> {
    /// Build the state from the service and the extractors' dependencies.
    pub fn new(
        service: Changes,
        entity_access: Arc<Access>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            entity_access,
            authorization_state,
        }
    }
}

// Manual Clone so `Changes` need not be Clone (it is behind an Arc).
impl<Changes, Access, Auth> Clone for AgentChangesRouterState<Changes, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            entity_access: Arc::clone(&self.entity_access),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Changes, Access, Auth> FromRef<AgentChangesRouterState<Changes, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &AgentChangesRouterState<Changes, Access, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<Changes, Access, Auth> FromRef<AgentChangesRouterState<Changes, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(state: &AgentChangesRouterState<Changes, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the changes router. Mount it under the session prefix the
/// composition root chooses, e.g. `/agent-sessions`, beside the session
/// routers.
pub fn agent_changes_router<Changes, Access, Auth, S>(
    state: AgentChangesRouterState<Changes, Access, Auth>,
) -> Router<S>
where
    Changes: AgentChanges,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/changes",
            get(get_agent_session_changes_handler::<Changes, Access, Auth>),
        )
        .route(
            "/{session_id}/changes/patch",
            get(get_agent_session_changes_patch_handler::<Changes, Access, Auth>),
        )
        .route(
            "/{session_id}/changes/refresh",
            post(refresh_agent_session_changes_handler::<Changes, Access, Auth>),
        )
        .with_state(state)
}

/// What happened to a file, on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeKindDto {
    /// The file did not exist before.
    Added,
    /// The file exists on both sides with different contents.
    Modified,
    /// The file no longer exists.
    Deleted,
    /// The file moved; `previousPath` says from where.
    Renamed,
}

impl From<FileChangeKind> for FileChangeKindDto {
    fn from(kind: FileChangeKind) -> Self {
        match kind {
            FileChangeKind::Added => Self::Added,
            FileChangeKind::Modified => Self::Modified,
            FileChangeKind::Deleted => Self::Deleted,
            FileChangeKind::Renamed => Self::Renamed,
        }
    }
}

/// The source of the captured diff, on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChangesetSourceDto {
    /// The diff of the session's linked GitHub pull request.
    GithubPullRequest,
}

impl From<ChangesetSource> for ChangesetSourceDto {
    fn from(source: ChangesetSource) -> Self {
        match source {
            ChangesetSource::GithubPullRequest => Self::GithubPullRequest,
        }
    }
}

/// How the latest capture attempt ended, on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaptureOutcomeDto {
    /// A changeset (possibly empty) was stored.
    Captured,
    /// The pull request was not available; `error` says why.
    NotReady,
    /// The extractor or storage failed; `error` says what a user can do.
    Failed,
}

impl From<AttemptOutcome> for CaptureOutcomeDto {
    fn from(outcome: AttemptOutcome) -> Self {
        match outcome {
            AttemptOutcome::Captured => Self::Captured,
            AttemptOutcome::NotReady => Self::NotReady,
            AttemptOutcome::Failed => Self::Failed,
        }
    }
}

/// One changed file.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFileDto {
    /// The file's path after the change, or before it for a deletion.
    pub path: String,
    /// Where a renamed file came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    /// What happened to the file.
    pub kind: FileChangeKindDto,
    /// Lines added.
    pub additions: u32,
    /// Lines removed.
    pub deletions: u32,
    /// The diff carries no text for this file.
    pub binary: bool,
    /// The file's hunks were left out of the patch to fit the size budget.
    pub patch_omitted: bool,
}

impl From<ChangedFile> for ChangedFileDto {
    fn from(file: ChangedFile) -> Self {
        Self {
            path: file.path,
            previous_path: file.previous_path,
            kind: file.kind.into(),
            additions: file.additions,
            deletions: file.deletions,
            binary: file.binary,
            patch_omitted: file.patch_omitted,
        }
    }
}

/// One end of the compared range.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GitRefDto {
    /// The branch name, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The commit, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

impl From<GitRef> for GitRefDto {
    fn from(git_ref: GitRef) -> Self {
        Self {
            name: git_ref.name,
            sha: git_ref.sha,
        }
    }
}

/// One capture of a session's changes.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangesetDto {
    /// The capture's id; changes with every capture.
    pub id: Uuid,
    /// Where the diff was read from.
    pub source: ChangesetSourceDto,
    /// `https://github.com/owner/name`, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// The side the work started from.
    pub base: GitRefDto,
    /// The side carrying the work.
    pub head: GitRefDto,
    /// Every changed file, in patch order.
    pub files: Vec<ChangedFileDto>,
    /// Lines added across all files.
    pub additions: u32,
    /// Lines removed across all files.
    pub deletions: u32,
    /// Size of the patch `GET .../changes/patch` serves; zero when nothing
    /// changed.
    pub patch_bytes: u64,
    /// Some files' hunks were left out of the patch.
    pub truncated: bool,
    /// When the diff was taken.
    pub captured_at: DateTime<Utc>,
}

impl From<Changeset> for ChangesetDto {
    fn from(changeset: Changeset) -> Self {
        Self {
            id: changeset.id.as_uuid(),
            source: changeset.source.into(),
            repository: changeset.range.repository,
            base: changeset.range.base.into(),
            head: changeset.range.head.into(),
            files: changeset.files.into_iter().map(Into::into).collect(),
            additions: changeset.additions,
            deletions: changeset.deletions,
            patch_bytes: changeset.patch_bytes,
            truncated: changeset.truncated,
            captured_at: changeset.captured_at,
        }
    }
}

/// The latest capture attempt.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureAttemptDto {
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// When it ended; absent while it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    /// How it ended; absent while it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CaptureOutcomeDto>,
    /// Why it did not capture, in a sentence the user can read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<CaptureAttempt> for CaptureAttemptDto {
    fn from(attempt: CaptureAttempt) -> Self {
        Self {
            started_at: attempt.started_at,
            finished_at: attempt.finished_at,
            outcome: attempt.outcome.map(Into::into),
            error: attempt.error,
        }
    }
}

/// Response body for `GET /agent-sessions/{session_id}/changes`.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionChangesResponse {
    /// The latest capture, if any succeeded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changeset: Option<ChangesetDto>,
    /// The latest attempt, if any was made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<CaptureAttemptDto>,
    /// A capture is running right now.
    pub capturing: bool,
}

impl From<SessionChanges> for AgentSessionChangesResponse {
    fn from(changes: SessionChanges) -> Self {
        let capturing = changes
            .attempt
            .as_ref()
            .is_some_and(CaptureAttempt::in_flight);
        Self {
            changeset: changes.changeset.map(Into::into),
            attempt: changes.attempt.map(Into::into),
            capturing,
        }
    }
}

/// Response body for `GET /agent-sessions/{session_id}/changes/patch`.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionChangesPatchResponse {
    /// The git-style unified diff of the current changeset.
    pub patch: String,
}

/// How the domain's refusals and failures answer on the wire.
#[derive(Debug)]
pub enum AgentChangesApiError {
    /// The domain rejected or failed the operation.
    Domain(ChangesError),
}

impl From<ChangesError> for AgentChangesApiError {
    fn from(error: ChangesError) -> Self {
        Self::Domain(error)
    }
}

impl IntoResponse for AgentChangesApiError {
    fn into_response(self) -> Response {
        match self {
            Self::Domain(ChangesError::Forbidden) => {
                (StatusCode::FORBIDDEN, "forbidden").into_response()
            }
            Self::Domain(error @ (ChangesError::NoChangeset | ChangesError::PatchMissing)) => {
                (StatusCode::NOT_FOUND, error.to_string()).into_response()
            }
            Self::Domain(ChangesError::Session(
                agent_session::domain::error::AgentSessionError::Forbidden,
            )) => (StatusCode::FORBIDDEN, "forbidden").into_response(),
            Self::Domain(error) => {
                tracing::error!(error = ?error, "agent session changes request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/changes",
    tag = "agent-sessions",
    operation_id = "get_agent_session_changes",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = AgentSessionChangesResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// The latest captured changes of an agent session: the changed files with
/// statuses and line counts, and how the latest capture attempt went.
#[tracing::instrument(skip_all, fields(agent.session.id = %access.entity_access_receipt.entity().entity_id), err(Debug))]
pub async fn get_agent_session_changes_handler<
    Changes: AgentChanges,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentChangesRouterState<Changes, Access, Auth>>,
) -> Result<Json<AgentSessionChangesResponse>, AgentChangesApiError> {
    let changes = state.service.changes(&access.entity_access_receipt).await?;
    Ok(Json(changes.into()))
}

#[utoipa::path(
    get,
    path = "/agent-sessions/{session_id}/changes/patch",
    tag = "agent-sessions",
    operation_id = "get_agent_session_changes_patch",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 200, body = AgentSessionChangesPatchResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
/// The unified diff behind the session's latest changeset.
#[tracing::instrument(skip_all, fields(agent.session.id = %access.entity_access_receipt.entity().entity_id), err(Debug))]
pub async fn get_agent_session_changes_patch_handler<
    Changes: AgentChanges,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<ViewAccessLevel, Access, Auth>,
    State(state): State<AgentChangesRouterState<Changes, Access, Auth>>,
) -> Result<Json<AgentSessionChangesPatchResponse>, AgentChangesApiError> {
    let patch = state.service.patch(&access.entity_access_receipt).await?;
    Ok(Json(AgentSessionChangesPatchResponse { patch }))
}

#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/changes/refresh",
    tag = "agent-sessions",
    operation_id = "refresh_agent_session_changes",
    params(("session_id" = Uuid, Path, description = "ID of the agent session")),
    responses(
        (status = 202, body = AgentSessionChangesResponse),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 500, body = String),
    )
)]
/// Capture the session's changes again now. Answers at once with the state
/// as it stands; the capture runs on and viewers are told when it lands.
#[tracing::instrument(skip_all, fields(agent.session.id = %access.entity_access_receipt.entity().entity_id), err(Debug))]
pub async fn refresh_agent_session_changes_handler<
    Changes: AgentChanges,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<AgentChangesRouterState<Changes, Access, Auth>>,
) -> Result<(StatusCode, Json<AgentSessionChangesResponse>), AgentChangesApiError> {
    let changes = state
        .service
        .request_capture(&access.entity_access_receipt)
        .await?;
    Ok((StatusCode::ACCEPTED, Json(changes.into())))
}
