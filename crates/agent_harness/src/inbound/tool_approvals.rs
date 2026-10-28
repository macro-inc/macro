//! Answering a tool call the egress proxy holds for the session's owner,
//! mounted under `/agent-sessions`.
//!
//! The caller needs edit access to the session, checked by the extractor
//! before the handler runs; beyond that, only the owner the approval names
//! may approve or decline, which the domain decides. Anyone with edit access
//! may cancel, so a turn is never stuck on an owner who is away.

use std::sync::Arc;

use agent_egress::domain::approval::{
    ApprovalAnswer, ToolApprovalAnswers, ToolApprovalError, ToolApprovalId,
};
use agent_egress::domain::model::AgentSessionId;
use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use axum::Router;
use axum::extract::{FromRef, Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::AgentSessionAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// How a person answers a held tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalAnswerDto {
    /// Let it run. Owner only.
    Approve,
    /// Let it run, and let the same person make the calls it covers in this
    /// session without asking again: the same tool on Macro, every tool of a
    /// connected app. Owner only.
    ApproveAndRemember,
    /// Refuse it. Owner only.
    Deny,
    /// Stop waiting on the owner. Anyone with edit access.
    Cancel,
}

impl From<ToolApprovalAnswerDto> for ApprovalAnswer {
    fn from(answer: ToolApprovalAnswerDto) -> Self {
        match answer {
            ToolApprovalAnswerDto::Approve => Self::Approve,
            ToolApprovalAnswerDto::ApproveAndRemember => Self::ApproveAndRemember,
            ToolApprovalAnswerDto::Deny => Self::Deny,
            ToolApprovalAnswerDto::Cancel => Self::Cancel,
        }
    }
}

/// Request body for answering a held tool call.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnswerToolApprovalRequest {
    /// The answer.
    pub answer: ToolApprovalAnswerDto,
}

/// Where a held tool call stands once answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalStatusDto {
    /// Still waiting. Never the answer to an answer; listed for completeness.
    Pending,
    /// Approved; the call went through.
    Approved,
    /// Declined; the call did not run.
    Denied,
    /// Cancelled; the call did not run.
    Cancelled,
    /// Nobody answered in time.
    Expired,
}

impl From<ToolApprovalStatus> for ToolApprovalStatusDto {
    fn from(status: ToolApprovalStatus) -> Self {
        match status {
            ToolApprovalStatus::Pending => Self::Pending,
            ToolApprovalStatus::Approved => Self::Approved,
            ToolApprovalStatus::Denied => Self::Denied,
            ToolApprovalStatus::Cancelled => Self::Cancelled,
            ToolApprovalStatus::Expired => Self::Expired,
        }
    }
}

/// Response body for answering a held tool call.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnswerToolApprovalResponse {
    /// Where the call stands now.
    pub status: ToolApprovalStatusDto,
}

/// Router state: the answers, plus what the access extractor resolves grants
/// and identity through.
pub struct ToolApprovalsRouterState<Approvals, Access, Auth> {
    approvals: Arc<Approvals>,
    entity_access: Arc<Access>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Approvals, Access, Auth> ToolApprovalsRouterState<Approvals, Access, Auth> {
    /// Build the state.
    pub fn new(
        approvals: Arc<Approvals>,
        entity_access: Arc<Access>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            approvals,
            entity_access,
            authorization,
        }
    }
}

impl<Approvals, Access, Auth> Clone for ToolApprovalsRouterState<Approvals, Access, Auth> {
    fn clone(&self) -> Self {
        Self {
            approvals: Arc::clone(&self.approvals),
            entity_access: Arc::clone(&self.entity_access),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Approvals, Access, Auth> FromRef<ToolApprovalsRouterState<Approvals, Access, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ToolApprovalsRouterState<Approvals, Access, Auth>) -> Self {
        state.authorization.clone()
    }
}

impl<Approvals, Access, Auth> FromRef<ToolApprovalsRouterState<Approvals, Access, Auth>>
    for Arc<Access>
{
    fn from_ref(state: &ToolApprovalsRouterState<Approvals, Access, Auth>) -> Self {
        Arc::clone(&state.entity_access)
    }
}

/// Build the router. Mount it under `/agent-sessions`.
pub fn tool_approvals_router<Approvals, Access, Auth, S>(
    state: ToolApprovalsRouterState<Approvals, Access, Auth>,
) -> Router<S>
where
    Approvals: ToolApprovalAnswers,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/tool-approvals/{approval_id}",
            post(answer_tool_approval_handler::<Approvals, Access, Auth>),
        )
        .with_state(state)
}

/// Why an answer was refused, on the wire.
#[derive(Debug)]
pub struct ToolApprovalApiError(ToolApprovalError);

impl IntoResponse for ToolApprovalApiError {
    fn into_response(self) -> Response {
        match self.0 {
            ToolApprovalError::NotFound => {
                (StatusCode::NOT_FOUND, "no such tool approval").into_response()
            }
            ToolApprovalError::NotPending => (
                StatusCode::CONFLICT,
                "the tool approval was already resolved",
            )
                .into_response(),
            ToolApprovalError::NotOwner => (
                StatusCode::FORBIDDEN,
                "only the session owner may approve or decline",
            )
                .into_response(),
            ToolApprovalError::NobodyToRemember => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "a call a bot made on nobody's behalf cannot be approved for good",
            )
                .into_response(),
            ToolApprovalError::Egress(error) => {
                tracing::error!(error = ?error, "answering a tool approval failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[utoipa::path(
    post,
    path = "/agent-sessions/{session_id}/tool-approvals/{approval_id}",
    tag = "agent-sessions",
    operation_id = "answer_agent_session_tool_approval",
    params(
        ("session_id" = Uuid, Path, description = "ID of the agent session"),
        ("approval_id" = Uuid, Path, description = "ID of the held tool call"),
    ),
    request_body = AnswerToolApprovalRequest,
    responses(
        (status = 200, body = AnswerToolApprovalResponse),
        (status = 401, body = String),
        (status = 403, body = String, description = "Not the owner, for approve or deny; or no edit access"),
        (status = 404, body = String),
        (status = 409, body = String, description = "Already resolved"),
        (status = 422, body = String, description = "Approve for good, for a call no person asked for"),
        (status = 500, body = String),
    )
)]
/// Answer a tool call the agent made in a turn somebody other than the
/// session's owner prompted. Approve and deny are the owner's; cancel is
/// anyone's with edit access.
#[tracing::instrument(skip_all, fields(%session_id, %approval_id), err(Debug))]
pub async fn answer_tool_approval_handler<Approvals, Access, Auth>(
    access: AgentSessionAccessLevelExtractor<EditAccessLevel, Access, Auth>,
    State(state): State<ToolApprovalsRouterState<Approvals, Access, Auth>>,
    Path((session_id, approval_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<AnswerToolApprovalRequest>,
) -> Result<Json<AnswerToolApprovalResponse>, Response>
where
    Approvals: ToolApprovalAnswers,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    // A person answers: a bot has no say over whose access is spent.
    let by = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|_| (StatusCode::FORBIDDEN, "a person must answer").into_response())?
        .clone();
    let approval = state
        .approvals
        .answer(
            AgentSessionId::new_from_uuid(session_id),
            ToolApprovalId::from_uuid(approval_id),
            request.answer.into(),
            &by,
        )
        .await
        .map_err(|error| ToolApprovalApiError(error).into_response())?;
    Ok(Json(AnswerToolApprovalResponse {
        status: approval.status.into(),
    }))
}
