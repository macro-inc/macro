//! Provider-neutral user-visible state for durable mailbox writes.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredOperationState {
    Pending,
    Running,
    Synced,
    Conflict,
    Unknown,
    Sent,
    Deleted,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftStage {
    Inspect,
    Creating,
    Updating,
    Attachments,
    Ready,
    Deleting,
    Submitting,
    Confirming,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageOperationIssue {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageOperationState {
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

/// Facts loaded only with an authorized message. Opaque versions are compared,
/// never interpreted as provider labels or provider-specific state on the client.
#[derive(Debug, Clone)]
pub struct MessageOperationFacts {
    pub state: StoredOperationState,
    pub stage: Option<DraftStage>,
    pub revision: i64,
    pub remote_version: Option<String>,
    pub issue: Option<MessageOperationIssue>,
}

#[derive(Debug, Clone)]
pub struct MessageOperationStatus {
    pub state: MessageOperationState,
    pub revision: i64,
    pub remote_version: Option<String>,
    pub issue: Option<MessageOperationIssue>,
}

impl From<MessageOperationFacts> for MessageOperationStatus {
    fn from(facts: MessageOperationFacts) -> Self {
        use MessageOperationState as Public;
        use StoredOperationState as Stored;
        let state = match facts.state {
            Stored::Pending | Stored::Running => match facts.stage {
                Some(DraftStage::Submitting) => Public::Submitting,
                Some(DraftStage::Confirming) => Public::Confirming,
                _ => Public::Pending,
            },
            Stored::Synced => Public::Synchronized,
            Stored::Conflict => Public::Conflict,
            Stored::Unknown => Public::Uncertain,
            Stored::Sent => Public::Sent,
            Stored::Deleted => Public::Deleted,
            Stored::Cancelled => Public::Cancelled,
            Stored::Failed => Public::Failed,
        };
        let state = if facts.issue == Some(MessageOperationIssue::AcceptingRemote) {
            Public::Pending
        } else {
            state
        };
        Self {
            state,
            revision: facts.revision,
            remote_version: facts.remote_version,
            issue: facts.issue,
        }
    }
}

/// An explicit user decision; automatic retry never constructs RetrySend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageResolutionAction {
    KeepLocal,
    UseProvider,
    Recheck,
    RetrySend,
    KeepOriginal,
}

#[derive(Debug, Clone)]
pub struct MessageResolutionRequest {
    pub message_id: uuid::Uuid,
    pub revision: i64,
    pub remote_version: Option<String>,
    pub action: MessageResolutionAction,
    pub accept_duplicate_risk: bool,
}

/// Validated transition that storage commits only if these facts still match.
pub struct MessageResolutionPlan {
    pub message_id: uuid::Uuid,
    pub expected: MessageOperationFacts,
    pub action: MessageResolutionAction,
}

pub fn plan_resolution(
    facts: MessageOperationFacts,
    request: MessageResolutionRequest,
) -> Result<MessageResolutionPlan, super::EmailErr> {
    let conflict = || super::EmailErr::MessageDeliveryConflict(request.message_id);
    if facts.revision != request.revision || facts.remote_version != request.remote_version {
        return Err(conflict());
    }
    let moving = matches!(
        facts.issue,
        Some(
            MessageOperationIssue::MovePending
                | MessageOperationIssue::MoveConflict
                | MessageOperationIssue::MoveSourceSent
                | MessageOperationIssue::MoveReauthorization
                | MessageOperationIssue::MoveOriginalRemains
        )
    );
    let permitted = match request.action {
        MessageResolutionAction::KeepOriginal => moving && request.accept_duplicate_risk,
        MessageResolutionAction::KeepLocal | MessageResolutionAction::UseProvider => {
            facts.state == StoredOperationState::Conflict
                && facts.issue == Some(MessageOperationIssue::DraftConflict)
                && facts.remote_version.is_some()
        }
        MessageResolutionAction::Recheck => {
            (moving && facts.state == StoredOperationState::Conflict)
                || facts.state == StoredOperationState::Unknown
                    && matches!(
                        facts.issue,
                        Some(
                            MessageOperationIssue::CreationUnknown
                                | MessageOperationIssue::AttachmentUnknown
                                | MessageOperationIssue::SendUnknown
                        )
                    )
        }
        MessageResolutionAction::RetrySend => {
            (facts.state == StoredOperationState::Unknown
                && facts.issue == Some(MessageOperationIssue::SendUnknown)
                && request.accept_duplicate_risk)
                || (facts.state == StoredOperationState::Failed
                    && facts.issue == Some(MessageOperationIssue::SendRejected))
        }
    };
    if !permitted {
        return Err(conflict());
    }
    Ok(MessageResolutionPlan {
        message_id: request.message_id,
        expected: facts,
        action: request.action,
    })
}
