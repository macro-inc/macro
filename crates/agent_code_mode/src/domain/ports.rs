use super::{
    CodeModeError, ExecutionId, ExecutionIdentity, ExecutionRecord, ModelImage, StaticFileId,
};
use agent_runtime_protocol::domain::job::JobUpdatedNotification;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::PendingNotification;
use async_trait::async_trait;
use code_execution::domain::RunEnvironment;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use utoipa::ToSchema;

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
    /// Approve a background job at its launch, in its turn, and name the
    /// account it acts as. Nothing is minted: [`Self::mint_job`] does that
    /// once the job holds a slot, so time in the queue is not token time.
    async fn approve_job(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        cancel: CancellationToken,
    ) -> Result<MacroUserIdStr<'static>, CodeModeError>;
    /// Mint the credential of a job [`Self::approve_job`] approved for
    /// `acting_user`, when it starts running. It is limited to the no-send
    /// scope and lasts until the job's deadline.
    async fn mint_job(
        &self,
        identity: &ExecutionIdentity,
        acting_user: &MacroUserIdStr<'static>,
    ) -> Result<IssuedRun, CodeModeError>;
    /// Revoke a job's credential, named by its correlation, once its
    /// program stopped: a copy of the token makes no request after that.
    async fn revoke_job(&self, correlation: macro_uuid::Uuid) -> Result<(), CodeModeError>;
    /// Whether this execution may run past its turn as a background job.
    /// A job never asks for an approval after its turn, so implementations
    /// allow it only where launching needs none.
    async fn may_detach(&self, identity: &ExecutionIdentity) -> Result<Detach, CodeModeError> {
        let _ = identity;
        Ok(Detach::Refused(
            "Background jobs are not available here.".into(),
        ))
    }
}

/// Whether an execution may become a background job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detach {
    /// It may.
    Allowed,
    /// It runs in the foreground, for this reason, told to the agent.
    Refused(String),
}

/// A run credential and the account it acts as.
pub struct IssuedRun {
    /// Fresh verified invocation signed into this run credential. Persist before starting it.
    pub correlation_id: macro_uuid::Uuid,
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

/// Where a running background job's row says it should go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobControl {
    /// Keep running.
    Running,
    /// Someone asked for it to stop.
    CancelRequested,
    /// It has already been settled, by a sweep or another replica.
    Settled,
    /// Its record, or its session, is gone.
    Gone,
}

/// What asking a job to stop did, as `{"outcome": ...}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema, ToSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum JobCancel {
    /// The job will stop within a second or so.
    Requested,
    /// It had already ended.
    AlreadySettled,
}

/// How many background jobs may run at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobCaps {
    /// In one session.
    pub per_session: u8,
    /// Across one account's sessions.
    pub per_account: u8,
}

/// Background job rows: the execution journal plus the columns that make
/// running jobs findable, capped, cancellable and sweepable.
#[async_trait]
pub trait JobStore: Send + Sync + 'static {
    /// Insert a running job's record unless its session or account already
    /// runs as many as `caps` allow ([`CodeModeError::JobLimit`]); a taken id
    /// is [`CodeModeError::Duplicate`].
    async fn launch(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        record: &ExecutionRecord,
        caps: JobCaps,
    ) -> Result<(), CodeModeError>;
    /// Save a running job's activity; never a settled one's.
    async fn save_activity(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError>;
    /// Where the job's row says it should go.
    async fn control(
        &self,
        session: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobControl, CodeModeError>;
    /// Ask a running job to stop; [`CodeModeError::NotFound`] for no such job.
    async fn request_cancel(
        &self,
        session: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobCancel, CodeModeError>;
    /// Save the job's final record and, in the same transaction, its
    /// notification. At most once: false when it was already settled.
    async fn settle(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
        notification: Option<&PendingNotification>,
    ) -> Result<bool, CodeModeError>;
    /// Up to `limit` jobs still running whose deadline passed before `before`.
    async fn overdue(
        &self,
        before: chrono::DateTime<chrono::Utc>,
        limit: u16,
    ) -> Result<Vec<(AgentSessionId, ExecutionRecord)>, CodeModeError>;
    /// The session's running jobs and those settled since `settled_since`,
    /// newest first, at most `limit`.
    async fn list(
        &self,
        session: AgentSessionId,
        settled_since: chrono::DateTime<chrono::Utc>,
        limit: u16,
    ) -> Result<Vec<ExecutionRecord>, CodeModeError>;
}

/// The session facts a running job watches and the log it reports to.
#[async_trait]
pub trait JobSessions: Send + Sync + 'static {
    /// Whether the session still exists and is not archived.
    async fn open(&self, session: AgentSessionId) -> Result<bool, CodeModeError>;
    /// Log a job's state change in its session so open views update.
    async fn announce(
        &self,
        session: AgentSessionId,
        update: &JobUpdatedNotification,
    ) -> Result<(), CodeModeError>;
}
