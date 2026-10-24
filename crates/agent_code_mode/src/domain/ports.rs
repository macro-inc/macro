use super::{CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord};
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
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
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

/// What the renderer would reject in a view a program returned for the user:
/// the same check the `Show` tool puts its views through.
pub trait ViewCheck: Send + Sync + 'static {
    /// Each problem with its place in the view; empty for a view it draws.
    fn problems(&self, view: &serde_json::Value) -> Vec<String>;
}
