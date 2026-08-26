//! The capabilities the session service requires from the outside.
//!
//! [`CursorAgents`] and [`RunStream`] are implemented by the Cursor API
//! client ([`crate::api`]); [`SessionNotifier`] by whatever transport the
//! session's updates travel over (the ACP stdio connection today, anything
//! that can carry a `session/update` tomorrow); [`RepoResolver`] by the git
//! adapter in [`crate::outbound`]. The service never sees HTTP, SSE framing,
//! JSON-RPC, or a subprocess — only these contracts.

use crate::domain::event::CursorEvent;
use crate::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl, RunListing,
    RunOutcome,
};
use agent_client_protocol::schema::v1::{SessionId, SessionUpdate};
use futures::Stream;
use std::path::Path;

/// Create and control Cursor cloud agents.
pub trait CursorAgents {
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
    fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
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

    /// The run's current status and, once terminal, its final answer text.
    ///
    /// The non-streaming read of what [`RunStream`] delivers live. It exists
    /// because the stream is the unreliable half of the API — observed
    /// answering `stream_unavailable` both in-stream and as a 409 in the
    /// seconds after a run's creation — while the run itself finishes fine
    /// server-side. A turn that cannot hold a stream falls back to polling
    /// this until the run is terminal, so flaky streaming degrades to a
    /// non-streamed answer instead of a lost one.
    fn run_result(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> impl Future<Output = Result<RunOutcome, rootcause::Report>> + Send;

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
    ) -> impl Future<Output = Result<Vec<RunListing>, rootcause::Report>> + Send;
}

/// Observe a run as a stream of decoded events.
///
/// The stream ends when the server closes it — normally just after a
/// [`CursorEvent::Done`]. A consumer that never sees a terminal
/// [`CursorEvent::Result`] must treat the run's outcome as unknown rather
/// than successful.
pub trait RunStream {
    /// The run's events, in arrival order.
    fn stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> impl Future<
        Output = Result<
            impl Stream<Item = Result<CursorEvent, rootcause::Report>> + Send,
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
}

/// Resolve the repository a new session should attach to.
///
/// Sessions without a repository still run, but the Cursor dashboard files
/// sessions under repositories, so a repo-less session never appears in the
/// user's sessions list. Whether that is acceptable is the service's call;
/// finding the repository is this port's.
pub trait RepoResolver {
    /// The repository for a session opened at `cwd`, if one can be resolved.
    fn resolve(&self, cwd: &Path) -> Option<RepoUrl>;
}
