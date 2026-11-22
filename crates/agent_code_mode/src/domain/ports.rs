use super::{
    CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord, ModelImage, ProgramLanguage,
    StaticFileId,
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
    /// `language` is the language `source` is written in, for the approver.
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        language: ProgramLanguage,
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

/// A per-owner backend rollout flag, such as whether a session owner may run
/// JS tools programs.
// Object-safe: code mode holds it as `Arc<dyn OwnerRollout>`.
#[async_trait]
pub trait OwnerRollout: Send + Sync + 'static {
    /// On for `owner`. A flag that cannot be read counts as off.
    async fn enabled(&self, owner: &macro_user_id::user_id::MacroUserIdStr<'static>) -> bool;
}

/// The code-mode kind of a session's current turn.
// Object-safe: the in-process agent and the internal MCP hold it as
// `Arc<dyn CodeModeKinds>`.
#[async_trait]
pub trait CodeModeKinds: Send + Sync + 'static {
    /// The kind `session`'s current turn runs, read from `owner`'s flag the
    /// first time it is asked for that turn and the same for the rest of it.
    /// Asked with no turn running, it reads the flag afresh.
    async fn code_mode_kind(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
    ) -> super::CodeModeKind;
}

/// Always [`CodeModeKind::TypeScript`](super::CodeModeKind::TypeScript): for
/// hosts without the agent permissions rollout.
pub struct TypeScriptOnly;

#[async_trait]
impl CodeModeKinds for TypeScriptOnly {
    async fn code_mode_kind(
        &self,
        _session: AgentSessionId,
        _owner: &MacroUserIdStr<'static>,
    ) -> super::CodeModeKind {
        super::CodeModeKind::TypeScript
    }
}
