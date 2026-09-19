//! The capabilities the session service requires from the outside.
//!
//! [`CursorAgents`] and [`RunStream`] are implemented by the Cursor API
//! client ([`crate::api`]); [`SessionNotifier`] by whatever transport the
//! session's updates travel over (the ACP stdio connection today, anything
//! that can carry a `session/update` tomorrow); [`RepositoryChooser`] by
//! a classifier for hosted Macro sessions or [`NoRepositoryChooser`] standalone.
//! Native records and polling bodies cross these
//! contracts for capture before decoding; HTTP I/O, SSE framing, JSON-RPC, and
//! subprocesses remain outside the service.

use crate::domain::artifact::{ArtifactListing, FetchedArtifact};
use crate::domain::model::{
    ConversationLine, CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl,
    RunListing,
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
    /// decision and has no effect without a repository.
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

    /// The agent's prompts and replies in order, as Cursor still holds them.
    ///
    /// The longest-lived record Cursor keeps, and the reason this exists: a
    /// run's stream expires within hours and its record drops its final text
    /// within weeks, while this still answers for agents whose every other
    /// trace is gone. It is where a prompt that was never captured here -
    /// a run driven from cursor.com, mirrored after its stream aged out -
    /// can still be found.
    ///
    /// Carries no run ids, so a line is tied to a run by matching text the
    /// journal already holds, never by position. See
    /// [`CursorSessionService::recover_lost_prompts`](crate::domain::service::CursorSessionService).
    fn conversation(
        &self,
        agent: &CursorAgentId,
    ) -> impl Future<Output = Result<Vec<ConversationLine>, rootcause::Report>> + Send;
}

/// Read the walkthrough files a Cursor agent saved.
///
/// A sibling of [`CursorAgents`] rather than more methods on it: the agent
/// lifecycle is what every session needs, and artifacts are what one optional
/// step at the end of a turn needs. Splitting them keeps a fake that scripts
/// a listing from having to script an agent lifecycle too.
pub trait CursorArtifacts: Sync {
    /// Every artifact the agent has written, across all of its runs.
    ///
    /// Cursor offers no run filter, so a later turn still sees everything
    /// earlier turns wrote; the caller diffs.
    fn list_artifacts(
        &self,
        agent: &CursorAgentId,
    ) -> impl Future<Output = Result<Vec<ArtifactListing>, rootcause::Report>> + Send;

    /// Fetch one artifact's bytes by its listed path.
    ///
    /// One call rather than "mint a url" then "fetch it": the url is a
    /// credential with a fifteen-minute life, and nothing above this port has
    /// any business holding one.
    fn fetch_artifact(
        &self,
        agent: &CursorAgentId,
        path: &str,
    ) -> impl Future<Output = Result<FetchedArtifact, rootcause::Report>> + Send;
}

/// Re-host an artifact's bytes somewhere that outlives the provider's link.
///
/// The domain's only opinion about storage is this trade: bytes in, a URL out
/// that is still good when someone reopens the conversation next year. Which
/// service that is, what it names the object, and how it authenticates are
/// all outside.
pub trait ArtifactStore: Send + Sync {
    /// Whether this deployment can re-host anything at all.
    ///
    /// A service built without a store — the standalone binary, most tests —
    /// skips artifact collection whole rather than listing files it would
    /// only fail to store one at a time. `false` is a configuration fact, not
    /// a failure, which is why it is a question and not an error.
    fn is_available(&self) -> bool {
        true
    }

    /// Store `bytes` under `file_name` and answer with their permanent URI.
    fn store(
        &self,
        file_name: &str,
        mime_type: &str,
        bytes: bytes::Bytes,
    ) -> impl Future<Output = Result<String, rootcause::Report>> + Send;
}

/// The store for a deployment that has nowhere to put artifacts.
///
/// Reports itself unavailable, so a session built with it never lists an
/// agent's artifacts; the error exists only for a caller that ignores that
/// and asks anyway.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoArtifactStore;

impl ArtifactStore for NoArtifactStore {
    fn is_available(&self) -> bool {
        false
    }

    async fn store(
        &self,
        _file_name: &str,
        _mime_type: &str,
        _bytes: bytes::Bytes,
    ) -> Result<String, rootcause::Report> {
        Err(rootcause::report!(
            "this session has no artifact store configured"
        ))
    }
}

/// One connected run stream, with what the provider said about resuming it.
pub struct ConnectedStream<Records> {
    /// Complete native records, captured before decoding or translation.
    pub records: Records,
    /// The provider's `X-Cursor-Stream-Retention-Seconds`, when it sent one.
    ///
    /// How long a dropped stream stays resumable. Not enforced here — the
    /// provider answers an expired resume with
    /// [`StreamConnectError::Expired`] — but worth logging, because a run
    /// whose tool call outlives the window can never be resumed and the
    /// number is the only warning of that.
    pub retention_seconds: Option<u64>,
}

/// Why one connect did not produce a stream.
///
/// The domain acts differently on each: an unavailable stream is retried, an
/// invalid resume position is retried without one, and an expired stream is
/// gone for good and leaves polling as the only way to learn the outcome.
#[derive(Debug)]
pub enum StreamConnectError {
    /// `stream_unavailable`: the stream is not there (yet). Carries the
    /// provider's message.
    Unavailable(String),
    /// `invalid_last_event_id`: the resume position is not this run's.
    InvalidResumePosition(String),
    /// `stream_expired`: the retention window closed behind us.
    Expired(String),
    /// Every other failure.
    Other(rootcause::Report),
}

impl std::fmt::Display for StreamConnectError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(message) => write!(formatter, "Cursor stream unavailable: {message}"),
            Self::InvalidResumePosition(message) => {
                write!(formatter, "Cursor rejected the resume position: {message}")
            }
            Self::Expired(message) => write!(formatter, "Cursor stream expired: {message}"),
            Self::Other(report) => write!(formatter, "{report}"),
        }
    }
}

/// Observe a run as a stream of native SSE records.
///
/// The stream ends when the server closes it — normally just after a
/// [`CursorEvent::Done`](super::event::CursorEvent::Done). A consumer that never sees a terminal
/// [`CursorEvent::Result`](super::event::CursorEvent::Result) must treat the run's outcome as unknown rather
/// than successful.
pub trait RunStream: Sync {
    /// Connect a run's stream, optionally resuming after an event id.
    ///
    /// `resume_from` is an id observed on an earlier record of this same run,
    /// passed back verbatim: the provider's ids are opaque and a consumer that
    /// parses or invents one gets [`StreamConnectError::InvalidResumePosition`].
    /// `None` connects from the beginning of what the provider still retains.
    fn raw_stream(
        &self,
        agent: &CursorAgentId,
        run: &CursorRunId,
        resume_from: Option<&str>,
    ) -> impl Future<
        Output = Result<
            ConnectedStream<
                impl Stream<Item = Result<super::journal::NativeRecord, rootcause::Report>> + Send,
            >,
            StreamConnectError,
        >,
    > + Send;
}

/// Deliver one translated update to the session's client.
pub trait SessionNotifier {
    /// Report the provider's PR to the host's shared session operation.
    fn set_pull_request(
        &self,
        session: &SessionId,
        url: &str,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

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
    /// wants a pull request. Hosted adapters choose from the prompt; standalone
    /// sessions leave the repository unset.
    ///
    /// An error is a failed prompt, not a reason to guess: a session pointed at
    /// the wrong repository is worse than a session that says it could not tell.
    fn choose(
        &self,
        prompt: &str,
        cwd: &std::path::Path,
    ) -> impl Future<Output = Result<SessionIntent, rootcause::Report>> + Send;
}

/// Leaves repository selection to Cursor in standalone sessions.
pub struct NoRepositoryChooser;

impl RepositoryChooser for NoRepositoryChooser {
    async fn choose(
        &self,
        _prompt: &str,
        _cwd: &std::path::Path,
    ) -> Result<SessionIntent, rootcause::Report> {
        Ok(SessionIntent::default())
    }
}
