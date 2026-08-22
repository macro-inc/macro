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
    AcpSessionId, CursorAgentId, CursorRunId, McpServer, RepoUrl, RunOutcome,
};
use agent_client_protocol::schema::v1::SessionUpdate;
use futures::Stream;
use std::path::Path;

/// Create and control Cursor cloud agents.
pub trait CursorAgents {
    /// Create an agent with its first run. Cursor has no bare "create agent":
    /// an agent only exists once there is a prompt to run, which is why this
    /// returns both ids at once.
    ///
    /// `mcp_servers` is applied here and nowhere else: Cursor fixes an
    /// agent's MCP configuration at creation, so a follow-up run cannot add
    /// to it. An empty slice leaves Cursor's own configuration untouched.
    fn create_agent(
        &self,
        prompt: &str,
        repo: Option<&RepoUrl>,
        mcp_servers: &[McpServer],
    ) -> impl Future<Output = Result<(CursorAgentId, CursorRunId), rootcause::Report>> + Send;

    /// Send a follow-up prompt to an existing agent, opening a new run.
    fn create_run(
        &self,
        agent: &CursorAgentId,
        prompt: &str,
    ) -> impl Future<Output = Result<CursorRunId, rootcause::Report>> + Send;

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
        session: &AcpSessionId,
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
