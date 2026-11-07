//! HTTP representation of provider-independent synchronization and delivery state.
use crate::domain::models::mailbox_operation::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Provider-neutral state exposed to clients.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiMessageOperationState {
    Pending,
    Synchronized,
    Conflict,
    Uncertain,
    Submitting,
    Confirming,
    Sent,
    Deleted,
    Cancelled,
    Failed,
}

impl From<MessageOperationState> for ApiMessageOperationState {
    fn from(value: MessageOperationState) -> Self {
        match value {
            MessageOperationState::Pending => Self::Pending,
            MessageOperationState::Synchronized => Self::Synchronized,
            MessageOperationState::Conflict => Self::Conflict,
            MessageOperationState::Uncertain => Self::Uncertain,
            MessageOperationState::Submitting => Self::Submitting,
            MessageOperationState::Confirming => Self::Confirming,
            MessageOperationState::Sent => Self::Sent,
            MessageOperationState::Deleted => Self::Deleted,
            MessageOperationState::Cancelled => Self::Cancelled,
            MessageOperationState::Failed => Self::Failed,
        }
    }
}

/// Provider-neutral state exposed to clients.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiMessageOperationIssue {
    AcceptingRemote,
    DraftConflict,
    CreationUnknown,
    AttachmentUnknown,
    SendUnknown,
    SendRejected,
    AccessRevoked,
    InvalidContent,
    MovePending,
    MoveConflict,
    MoveSourceSent,
    MoveReauthorization,
    MoveOriginalRemains,
}

impl From<MessageOperationIssue> for ApiMessageOperationIssue {
    fn from(value: MessageOperationIssue) -> Self {
        match value {
            MessageOperationIssue::AcceptingRemote => Self::AcceptingRemote,
            MessageOperationIssue::DraftConflict => Self::DraftConflict,
            MessageOperationIssue::CreationUnknown => Self::CreationUnknown,
            MessageOperationIssue::AttachmentUnknown => Self::AttachmentUnknown,
            MessageOperationIssue::SendUnknown => Self::SendUnknown,
            MessageOperationIssue::SendRejected => Self::SendRejected,
            MessageOperationIssue::AccessRevoked => Self::AccessRevoked,
            MessageOperationIssue::InvalidContent => Self::InvalidContent,
            MessageOperationIssue::MovePending => Self::MovePending,
            MessageOperationIssue::MoveConflict => Self::MoveConflict,
            MessageOperationIssue::MoveSourceSent => Self::MoveSourceSent,
            MessageOperationIssue::MoveReauthorization => Self::MoveReauthorization,
            MessageOperationIssue::MoveOriginalRemains => Self::MoveOriginalRemains,
        }
    }
}

/// Versions are opaque decimal strings so clients never truncate an i64.
#[derive(Debug, Serialize, ToSchema)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct ApiMessageOperation {
    pub state: ApiMessageOperationState,
    pub revision: String,
    pub remote_version: Option<String>,
    pub issue: Option<ApiMessageOperationIssue>,
}
impl From<MessageOperationStatus> for ApiMessageOperation {
    fn from(status: MessageOperationStatus) -> Self {
        Self {
            state: status.state.into(),
            revision: status.revision.to_string(),
            remote_version: status.remote_version,
            issue: status.issue.map(Into::into),
        }
    }
}

/// A deliberate resolution of a particular observed operation version.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiMessageResolutionAction {
    KeepLocal,
    UseProvider,
    Recheck,
    RetrySend,
    KeepOriginal,
}
impl From<ApiMessageResolutionAction> for MessageResolutionAction {
    fn from(action: ApiMessageResolutionAction) -> Self {
        match action {
            ApiMessageResolutionAction::KeepLocal => Self::KeepLocal,
            ApiMessageResolutionAction::UseProvider => Self::UseProvider,
            ApiMessageResolutionAction::Recheck => Self::Recheck,
            ApiMessageResolutionAction::RetrySend => Self::RetrySend,
            ApiMessageResolutionAction::KeepOriginal => Self::KeepOriginal,
        }
    }
}
/// Stale versions fail without altering the current operation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ResolveMessageOperationRequest {
    pub revision: String,
    pub remote_version: Option<String>,
    pub action: ApiMessageResolutionAction,
    #[serde(default)]
    pub accept_duplicate_risk: bool,
}

/// Authorized polling response. Gmail has no asynchronous draft operation.
#[derive(Serialize, ToSchema)]
pub struct MessageOperationResponse {
    pub operation: Option<ApiMessageOperation>,
}
