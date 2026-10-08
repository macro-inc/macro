use super::{CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord, ToolDocumentation};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use code_execution::domain::HostResult;
use serde_json::Value;
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

/// Registered tools; implementations retain their own domain authorization.
#[async_trait]
pub trait CodeModeTools: Send + Sync + 'static {
    /// The exact runtime catalog, including schemas and interactive-tool facts.
    fn catalog(&self) -> Vec<ToolDocumentation>;
    /// Dispatch with server-bound identity and cancellation.
    async fn call(
        &self,
        identity: &ExecutionIdentity,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> HostResult;
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
