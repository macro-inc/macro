//! The capabilities the session service requires from the outside.
//!
//! [`CursorAgents`] and [`RunStream`] are implemented by the Cursor API
//! client ([`crate::api`]); [`SessionNotifier`] by whatever transport the
//! session's updates travel over (the ACP stdio connection today, anything
//! that can carry a `session/update` tomorrow); [`RepositoryChooser`] by
//! whatever can read the prompt and the user's repositories - the git adapter
//! in [`crate::outbound`] standalone, a classifier in the harness when the
//! session belongs to a Macro user. Native records and polling bodies cross these
//! contracts for capture before decoding; HTTP I/O, SSE framing, JSON-RPC, and
//! subprocesses remain outside the service.

use crate::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl, RunListing,
};
use agent_client_protocol::schema::v1::{SessionId, SessionUpdate};
use futures::Stream;

/// Create and control Cursor cloud agents.
pub trait CursorAgents: Sync {
    /// Raw successful polling body, captured before interpretation, including
    /// provider fields unknown to the domain. A turn whose stream is unavailable
    /// falls back to polling this until the run is terminal.
    fn raw_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> impl Future<Output = Result<String, rootcause::Report>> + Send;

    /// Create an agent with its first run. Cursor has no bare "create agent":
    /// an agent only exists once there is a prompt to run, which is why this
    /// returns both ids at once.
    ///
    /// `mcp_servers` is applied here: Cursor fixes an agent's MCP
    /// configuration at creation. An empty slice leaves Cursor's own
    /// configuration untouched.
    ///
    /// `model` absent means "whatever the user's own Cursor settings resolve
    /// to" — Cursor falls back user default, then team, then system — which is
    /// a better default than any id this crate could pick.
    ///
    /// `open_pull_request` asks Cursor to push its work to a generated branch
    /// and open a pull request against the starting ref. It is a caller's
    /// decision, not a property of the request shape, so it is a parameter:
    /// today the caller answers "whenever there is a repository", and later a
    /// classifier will answer from what the prompt actually asked for. It is
    /// meaningless without a repository.
    fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        open_pull_request: bool,
        mcp_servers: &[McpServer],
        model: Option<&ModelChoice>,
    ) -> impl Future<Output = Result<(CursorAgentId, CursorRunId), rootcause::Report>> + Send;

    /// Send a follow-up prompt to an existing agent, opening a new run.
    ///
    /// `model` is honoured per run, which is what makes a mid-session model
    /// change possible: the field is undocumented on this endpoint but
    /// validated by it, and absent means the agent's own model stands.
    fn create_run(
        &self,
        agent: &CursorAgentId,
        prompt: &str,
        model: Option<&ModelChoice>,
    ) -> impl Future<Output = Result<CursorRunId, rootcause::Report>> + Send;

    /// The models this account may choose from, with the variants each accepts.
    ///
    /// Cursor validates an id together with its params, so the variants are
    /// not decoration — they are the only source of a selection it will accept.
    fn list_models(
        &self,
    ) -> impl Future<Output = Result<Vec<CursorModel>, rootcause::Report>> + Send;

    /// Cancel a run. Terminal: a cancelled run cannot resume.
    fn cancel_run(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// The agent's runs, newest first.
    ///
    /// How a session finds out what happened to its agent while it was not
    /// looking: the conversation also advances from cursor.com (the agent's
    /// page there drives the same agent), and those runs never pass through
    /// this session. Before a new prompt, the runs since the last one this
    /// session drove are backfilled so the client's view does not silently
    /// fork from the conversation the new prompt continues.
    fn list_runs(
        &self,
        agent: &CursorAgentId,
        through: Option<&CursorRunId>,
    ) -> impl Future<Output = Result<Vec<RunListing>, rootcause::Report>> + Send;
}

/// Observe a run as a stream of native SSE records.
///
/// The stream ends when the server closes it — normally just after a
/// [`CursorEvent::Done`](super::event::CursorEvent::Done). A consumer that never sees a terminal
/// [`CursorEvent::Result`](super::event::CursorEvent::Result) must treat the run's outcome as unknown rather
/// than successful.
pub trait RunStream: Sync {
    /// Complete native records, captured before decoding or translation.
    fn raw_stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> impl Future<
        Output = Result<
            impl Stream<Item = Result<super::journal::NativeRecord, rootcause::Report>> + Send,
            rootcause::Report,
        >,
    > + Send;
}

/// Deliver one translated update to the session's client.
pub trait SessionNotifier {
    /// Send a `session/update` for the given session.
    fn notify(
        &self,
        session: &SessionId,
        update: SessionUpdate,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Ask the host to load recovered history after the current prompt completes.
    /// This must only enqueue a signal: the caller holds the session writer gate.
    fn require_reload(
        &self,
        session: &SessionId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Emit a terminal lifecycle fact after the reconstructed turn's updates.
    fn turn_complete(
        &self,
        session: &SessionId,
        outcome: agent_runtime_protocol::domain::turn::TurnOutcome,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Emit a non-rendering marker after every update for `run` was delivered.
    /// Durable hosts use it to atomically checkpoint the run with their log.
    fn checkpoint(
        &self,
        session: &SessionId,
        run: &CursorRunId,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// What a session's first prompt asks for, decided before the agent is minted.
///
/// The two answers travel together because they are one decision: Cursor can
/// only open a pull request against a repository, so `open_pull_request` is
/// meaningless without `repository` and the chooser is the only place that
/// knows both.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionIntent {
    /// The repository the work belongs to, when one clearly does.
    pub repository: Option<RepoUrl>,
    /// Whether the work should ship as a pull request.
    pub open_pull_request: bool,
}

/// Decide which repository a prompt's work belongs to.
///
/// Asked once per session, at the first prompt, because the prompt is the only
/// evidence there is: a session opened from a chat message names no checkout,
/// and the repository has to be right before the agent is minted - Cursor fixes
/// an agent's repository at creation.
///
/// Sessions without a repository still run, but the Cursor dashboard files
/// sessions under repositories, so a repo-less session never appears in the
/// user's sessions list. Whether that is acceptable is the service's call;
/// deciding is this port's.
pub trait RepositoryChooser: Send + Sync {
    /// The repository this prompt's work belongs to, if any, and whether it
    /// wants a pull request.
    ///
    /// An error is a failed prompt, not a reason to guess: a session pointed at
    /// the wrong repository is worse than a session that says it could not tell.
    fn choose(
        &self,
        prompt: &str,
    ) -> impl Future<Output = Result<SessionIntent, rootcause::Report>> + Send;
}
