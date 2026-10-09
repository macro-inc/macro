//! Durable admission and execution records for channel messages addressed to a persona.

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{error::Result, model::AgentSessionId};
use macro_uuid::Uuid;

use super::{
    model::{AgentRuntimeConfig, OpenSession, PermissionPolicyConfig, ReplyOutcome},
    queue::InFlightTurn,
};

/// The state of one source message, retained after completion for deduplication.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum DmTurnState {
    /// Accepted durably; no model request has been dispatched.
    Queued,
    /// Claimed for dispatch; it may have performed external actions.
    Running,
    /// The turn finished successfully.
    Succeeded,
    /// The turn failed; retry requires the user's explicit action.
    Failed,
    /// The user stopped the turn.
    Stopped,
    /// The managing process disappeared; never automatically repeat its work.
    Interrupted,
}

/// Original command and the outcome of its current attempt.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DmTurn {
    /// Immutable source identity, even when a broker replays after a context reset.
    pub source_message_id: Uuid,
    /// The segment chosen on first admission.
    pub session_id: AgentSessionId,
    /// Private channel containing this turn.
    pub channel_id: Uuid,
    /// Runtime request identity. Explicit retry mints a fresh one.
    pub action_id: AgentActionId,
    /// Original persona configuration, prompt, attachments and owner.
    pub command: OpenSession,
    /// Durable execution state.
    pub state: DmTurnState,
    /// Reply placement and runtime turn identity, recorded before delivery.
    pub in_flight: Option<InFlightTurn>,
    /// Outcome saved before patching the channel reply.
    pub outcome: Option<ReplyOutcome>,
    /// Whether the channel reply has been reconciled with the saved outcome.
    pub reply_finalized: bool,
    /// Stable admission order within the transcript.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Small transcript projection. Polling must never reload stored prompts or attachments.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DmTurnStatus {
    /// Source channel message.
    pub source_message_id: Uuid,
    /// Context that accepted this message.
    pub session_id: AgentSessionId,
    /// Current attempt identity.
    pub action_id: AgentActionId,
    /// Reply in the channel timeline, when one was reserved.
    pub reply_message_id: Option<Uuid>,
    /// Current execution state.
    pub state: DmTurnState,
    /// Stable admission ordering.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Persistence mechanics only; authorization and execution decisions stay in the harness.
/// A held reply reconciliation claim. Dropping it releases the claim, including
/// on cancellation; no external action is retried by acquiring this lease.
pub trait DmReplyLease: Send {}

/// The persona configuration adopted when a context segment first opens.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DmSessionSettings {
    /// Instructions, model, runtime and selected tools for this context.
    pub runtime: AgentRuntimeConfig,
    /// Persona permission choice at adoption time. The operator may still revoke bypass.
    pub permissions: PermissionPolicyConfig,
}

/// Persistence mechanics only; authorization and execution decisions stay in the harness.
#[async_trait::async_trait]
pub trait DmTurnStore: Send + Sync + 'static {
    /// Serialize bootstrap and local queue admission before a session manager exists.
    async fn claim_delivery(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<Box<dyn DmReplyLease>>>;
    /// Serialize context changes with runtime dispatch across replicas.
    async fn claim_context(&self, session: AgentSessionId)
    -> Result<Option<Box<dyn DmReplyLease>>>;
    /// Cancel work that has not dispatched when its owner starts fresh.
    async fn cancel_queued(&self, session: AgentSessionId) -> Result<()>;
    /// Read the settings adopted by this segment, if it has opened.
    async fn settings(&self, session: AgentSessionId) -> Result<Option<DmSessionSettings>>;
    /// First writer wins, including a crash before the runtime row was created.
    async fn pin_settings(
        &self,
        session: AgentSessionId,
        settings: DmSessionSettings,
    ) -> Result<DmSessionSettings>;
    /// Atomically insert or return the first admission, never replacing its payload.
    async fn admit(
        &self,
        session: AgentSessionId,
        channel: Uuid,
        command: OpenSession,
    ) -> Result<DmTurn>;
    /// Read a source message's durable admission.
    async fn get(&self, source: Uuid) -> Result<Option<DmTurn>>;
    /// Resolve the current runtime attempt without assuming its id is the source id.
    async fn by_action(&self, action: AgentActionId) -> Result<Option<DmTurn>>;
    /// Compare-and-swap an explicitly retried failed attempt to a fresh action id.
    async fn retry(&self, source: Uuid, expected: AgentActionId) -> Result<bool>;
    /// At most one replica can move a queued attempt onto a runtime.
    async fn claim(&self, action: AgentActionId, turn: &InFlightTurn) -> Result<bool>;
    /// Save the posted reply before the model can begin producing output.
    async fn record_flight(&self, action: AgentActionId, turn: &InFlightTurn) -> Result<()>;
    /// Save a terminal outcome before resolving the channel message.
    async fn finish(
        &self,
        action: AgentActionId,
        state: DmTurnState,
        outcome: ReplyOutcome,
    ) -> Result<()>;
    /// Mark the saved outcome as visible in the channel.
    async fn finalize_reply(&self, action: AgentActionId, outcome: &ReplyOutcome) -> Result<()>;
    /// Serialize reply reconciliation across replicas, with release on process loss.
    async fn claim_reply(&self, action: AgentActionId) -> Result<Option<Box<dyn DmReplyLease>>>;
    /// Durable queued work for recovery, in admission order.
    async fn pending(&self, limit: u16) -> Result<Vec<DmTurn>>;
    /// Claims whose session manager must still be alive; used only for recovery checks.
    async fn running(&self, limit: u16) -> Result<Vec<DmTurn>>;
    /// Read the owner's transcript-associated statuses after channel authorization.
    async fn for_channel(&self, channel: Uuid) -> Result<Vec<DmTurnStatus>>;
    /// Completed outcomes whose reply patch must be retried, without running a model.
    async fn pending_replies(&self, limit: u16) -> Result<Vec<DmTurn>>;
}
