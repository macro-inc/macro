use super::{
    CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord, ModelImage, StaticFileId,
};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use code_execution::domain::RunEnvironment;
use macro_user_id::user_id::MacroUserIdStr;
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
    ) -> Result<IssuedRun, CodeModeError>;
}

/// A run credential and the account it acts as.
pub struct IssuedRun {
    /// What the program runs with.
    pub environment: RunEnvironment,
    /// The account the credential was minted for.
    pub acting_user: MacroUserIdStr<'static>,
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

/// Pixels of the static files a program returned in `images`.
#[async_trait]
pub trait ModelImages: Send + Sync + 'static {
    /// Read one static file `owner` owns as a bounded PNG; a file someone
    /// else owns, or anything but a PNG, is an error.
    async fn load_png(
        &self,
        file: &StaticFileId,
        owner: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage>;
}
