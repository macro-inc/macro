use async_graphql::{Enum, SimpleObject};
use email::domain::models::mailbox_operation::{
    MessageOperationIssue, MessageOperationState, MessageOperationStatus,
};

/// Provider-independent progress for an email write or delivery attempt.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(name = "EmailMessageOperationState")]
pub enum GraphqlMessageOperationState {
    /// Changes are waiting to synchronize.
    Pending,
    /// The current revision is synchronized.
    Synchronized,
    /// The provider changed since the local edit began.
    Conflict,
    /// A write may have succeeded and needs reconciliation.
    Uncertain,
    /// The send attempt has been recorded.
    Submitting,
    /// Provider acceptance is being reconciled with sent mail.
    Confirming,
    /// The sent copy was confirmed.
    Sent,
    /// The draft deletion was confirmed.
    Deleted,
    /// The operation was cancelled.
    Cancelled,
    /// The operation needs a correction before retry.
    Failed,
}

/// The decision needed from the user after a provider write could not complete.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(name = "EmailMessageOperationIssue")]
pub enum GraphqlMessageOperationIssue {
    /// The selected provider content is being loaded.
    AcceptingRemote,
    /// Local and provider edits conflict.
    DraftConflict,
    /// Draft creation could not be confirmed.
    CreationUnknown,
    /// Attachment creation could not be confirmed.
    AttachmentUnknown,
    /// Delivery could not be confirmed; automatic resend is forbidden.
    SendUnknown,
    /// The provider definitively rejected delivery; a deliberate retry is safe.
    SendRejected,
    /// The initiating user no longer has access.
    AccessRevoked,
    /// The provider rejected the request.
    InvalidContent,
    /// The old delivery identity is being retired.
    MovePending,
    /// The source draft changed before retirement.
    MoveConflict,
    /// The original was sent outside Macro.
    MoveSourceSent,
    /// Source mailbox access must be restored.
    MoveReauthorization,
    /// Conditional cleanup is unavailable; the original remains in its mailbox.
    MoveOriginalRemains,
}

/// Opaque versions let the server reject a resolution of an obsolete conflict.
#[derive(SimpleObject)]
#[graphql(name = "EmailMessageOperation")]
pub struct GraphqlMessageOperation {
    /// The current synchronization or delivery state of this message operation.
    state: GraphqlMessageOperationState,
    /// The opaque local revision that a resolution must acknowledge.
    revision: String,
    /// The observed provider version required to resolve an external draft conflict.
    remote_version: Option<String>,
    /// The reason the operation needs attention, when one is available.
    issue: Option<GraphqlMessageOperationIssue>,
}

impl From<MessageOperationStatus> for GraphqlMessageOperation {
    fn from(status: MessageOperationStatus) -> Self {
        use GraphqlMessageOperationState as G;
        use MessageOperationState as S;
        let state = match status.state {
            S::Pending => G::Pending,
            S::Synchronized => G::Synchronized,
            S::Conflict => G::Conflict,
            S::Uncertain => G::Uncertain,
            S::Submitting => G::Submitting,
            S::Confirming => G::Confirming,
            S::Sent => G::Sent,
            S::Deleted => G::Deleted,
            S::Cancelled => G::Cancelled,
            S::Failed => G::Failed,
        };
        Self {
            state,
            revision: status.revision.to_string(),
            remote_version: status.remote_version,
            issue: status.issue.map(Into::into),
        }
    }
}

impl From<MessageOperationIssue> for GraphqlMessageOperationIssue {
    fn from(issue: MessageOperationIssue) -> Self {
        match issue {
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
