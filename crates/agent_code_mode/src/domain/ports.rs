use super::{CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord, ProgramLanguage};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use code_execution::domain::RunEnvironment;
use tokio_util::sync::CancellationToken;

/// Current session turn, read from shared state on every replica.
#[async_trait]
pub trait ExecutionTurns: Send + Sync + 'static {
    /// Starting, running, or blocked turn; absent once stopped, ended, archived, or deleted.
    async fn active(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<macro_uuid::Uuid>, CodeModeError>;
}

/// Authorize a run and mint a short-lived user credential before starting Deno.
#[async_trait]
pub trait ExecutionCredentials: Send + Sync + 'static {
    /// Identity comes from the session, never from generated code. Implementations
    /// apply owner approval before minting and never persist the credential.
    /// `language` is the language `source` is written in, for the approver.
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        language: ProgramLanguage,
        cancel: CancellationToken,
    ) -> Result<RunEnvironment, CodeModeError>;
}

/// Durable code execution records, always scoped by the owning session.
#[async_trait]
pub trait ExecutionStore: Send + Sync + 'static {
    /// Insert before execution; fail without running tools if persistence is unavailable.
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError>;
    /// Replace this session's running record. Terminal records are immutable so
    /// delayed writes from cancelled dispatches cannot overwrite the final state.
    async fn save(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError>;
    /// Fetch only within the authorized session.
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError>;
}

/// A per-owner backend rollout flag, such as whether a session owner may run
/// OCaml programs.
// Object-safe: code mode holds it as `Arc<dyn OwnerRollout>`.
#[async_trait]
pub trait OwnerRollout: Send + Sync + 'static {
    /// On for `owner`. A flag that cannot be read counts as off.
    async fn enabled(&self, owner: &macro_user_id::user_id::MacroUserIdStr<'static>) -> bool;
}
