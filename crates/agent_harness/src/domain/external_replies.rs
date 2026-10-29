//! Join an external runtime's turn with its independently delivered thread reply.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{error::Result, model::AgentSessionId};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::model::{AnnounceOrigin, ReplyOutcome};

/// The authorized destination of one external chat reply.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExternalReplyTarget {
    /// The observed message's origin, never inferred from the current turn.
    pub origin: AnnounceOrigin,
    /// The user who caused the reply; current access is checked before posting.
    pub actor: MacroUserIdStr<'static>,
    /// Reserved before posting so a retry addresses the same message.
    pub message_id: Uuid,
}

/// The terminal result, retained even if the announcement has not arrived yet.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExternalReplyCompletion {
    /// Turn position reported by the session fold.
    pub turn: agent_fold::domain::model::TurnId,
    /// The answer or terminal failure to show in the thread.
    pub outcome: ReplyOutcome,
}

/// A join of the announcement and completion of one externally delivered prompt.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ExternalReply {
    /// Session whose runtime produced the response.
    pub session_id: AgentSessionId,
    /// The triggering message ID, also sent as the runtime action ID.
    pub action_id: AgentActionId,
    /// Absent if the runtime finished before the broker delivered the announcement.
    pub target: Option<ExternalReplyTarget>,
    /// Absent while the runtime is still working.
    pub completion: Option<ExternalReplyCompletion>,
    /// First reservation/result time; retries never reset the recovery backoff.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether the pending message was successfully posted.
    pub announced: bool,
    /// Whether the reply was shown or its destination permanently disappeared.
    pub finalized: bool,
}

/// Held while reconciling a reply; releasing it must also work on cancellation.
pub trait ExternalReplyLease: Send {}

/// Durable reply bookkeeping. Authorization and posting policy stay in the harness.
/// Object safe because the host supplies this optional persistence capability.
#[async_trait::async_trait]
pub trait ExternalReplyStore: Send + Sync + 'static {
    /// Keep the first authorized destination and reserved reply ID.
    async fn reserve(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        target: &ExternalReplyTarget,
    ) -> Result<()>;
    /// Keep the first terminal result, including when it precedes the destination.
    async fn complete(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        completion: &ExternalReplyCompletion,
    ) -> Result<()>;
    /// Read one reply after obtaining its reconciliation lease.
    async fn get(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> Result<Option<ExternalReply>>;
    /// Serialize posting across replicas without holding a row lock during HTTP calls.
    async fn claim(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> Result<Option<Box<dyn ExternalReplyLease>>>;
    /// Remember a successful post; a lost response still retries the reserved ID.
    async fn mark_announced(&self, session: AgentSessionId, action: AgentActionId) -> Result<()>;
    /// Finish after posting succeeds or the origin is permanently invalid.
    async fn finalize(&self, session: AgentSessionId, action: AgentActionId) -> Result<()>;
    /// Bounded recovery of unfinished replies, including missing completion callbacks.
    async fn pending(&self, limit: u16) -> Result<Vec<ExternalReply>>;
}
