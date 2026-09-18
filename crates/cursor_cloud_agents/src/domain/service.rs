//! The session service: the use cases an ACP client can drive.
//!
//! One ACP session maps to one Cursor agent, created lazily on the first
//! prompt (Cursor mints an agent and its first run together). Each later
//! prompt opens a follow-up run on the same agent, so the conversation
//! accumulates server-side. A turn is: create the run, stream its events,
//! translate each into session updates, deliver them through the notifier,
//! and answer with the ACP stop reason once the stream ends.
//!
//! Concurrency: ACP turns are strictly sequential per session, and the
//! service enforces that — a second prompt while one is streaming is an
//! error, not a queue. `session/cancel` is the exception: it must land *while*
//! a turn is streaming, so cancellation state lives behind a lock the
//! streaming loop never holds across an await.
//!
//! `session/cancel` is a notification we pump into Cursor: `POST
//! /v1/agents/{id}/runs/{runId}/cancel`. The turn itself keeps reading the
//! run's stream until Cursor's terminal `result` frame (then `done`) — the
//! same way a finished run ends. Cancellation is terminal on Cursor's side;
//! that `result` is what closes the ACP prompt.
//!
//! The cancellation token never cuts a live stream short — that is the whole
//! point of the paragraph above. It ends the waits where there is nothing to
//! read: a prompt queued behind `agent_busy`, and the fallback poll, which
//! only runs because the stream is gone. Reading `GET …/runs/{run}` once more
//! after the user has stopped buys nothing a stopped turn reports anyway, so
//! the poll's wait is where a stop lands.
//!
//! The remote cancel still needs a run id, and this process only remembers
//! one for a turn it is itself streaming. A session restored after a restart,
//! or one whose run started from cursor.com, has no such memory — cancelling
//! it falls back to asking Cursor which run is current rather than silently
//! skipping the remote call. A stop that beats the run into existence has
//! nothing to fall back to, so [`CursorSessionService::prompt`] re-sends it
//! the moment the run has an id; otherwise the stop would be swallowed and
//! the turn would run to the agent's own natural end.

#[cfg(test)]
mod test;

use crate::domain::artifact::{ArtifactListing, CollectedArtifact, mime_type};
use crate::domain::error::SessionError;
use crate::domain::event::CursorEvent;
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput, ReplayMachine};
use crate::domain::model::{
    ConversationLine, ConversationSpeaker, CursorAgentId, CursorModel, CursorRunId, McpServer,
    ModelChoice, RepoUrl, RunStatus,
};
use crate::domain::ports::{
    ArtifactStore, CursorAgents, CursorArtifacts, RepositoryChooser, RunStream, SessionIntent,
    SessionNotifier, StreamConnectError,
};
use agent_client_protocol::schema::v1::{
    ContentBlock, SessionId, SessionUpdate, StopReason, TextContent,
};
use futures::StreamExt as _;
use futures::pin_mut;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// How often the fallback poll asks after a run's outcome.
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Polls before a turn is abandoned — fifteen minutes, comfortably past any
/// run in the recorded corpus while still an ending.
const POLL_ATTEMPTS: usize = 450;

/// Consecutive poll failures tolerated before the turn takes the error.
const POLL_ERROR_TOLERANCE: usize = 5;

/// A stream this quiet gets its run's record checked. Observed live: the
/// final text arrives and the stream then hangs open, its terminal `result`
/// minutes behind — and the client shows a turn still "writing" long after
/// the answer is on screen. Long enough to never fire during ordinary
/// streaming; short enough that a finished run closes its turn promptly. A
/// still-running run (quiet tool work) just costs one status read per
/// interval.
const STREAM_QUIET_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Backoff before each reconnect of an interrupted stream.
///
/// Observed twice in production: the SSE body fails mid-run during a long tool
/// call while the run itself carries on fine, and everything Cursor says
/// between the drop and the run's end — tool results, prose, the images it
/// writes into prose — never reaches the transcript. Resuming from the last
/// event id gets that back; the ramp keeps a provider that is actually down
/// from being hammered.
const STREAM_RECONNECT_DELAYS: [std::time::Duration; 5] = [
    std::time::Duration::from_millis(500),
    std::time::Duration::from_secs(1),
    std::time::Duration::from_secs(2),
    std::time::Duration::from_secs(4),
    std::time::Duration::from_secs(8),
];

/// Reconnects before a run gives up on its stream and polls instead. Counted
/// since the last reconnect that delivered content, so a long run that drops
/// repeatedly but recovers each time is never rationed.
const STREAM_RECONNECT_ATTEMPTS: usize = 5;

/// How long a prompt waits behind a run something else started (the same
/// agent is drivable from cursor.com) before giving up, in poll intervals.
const BUSY_ATTEMPTS: usize = 450;

/// How long a turn that saw no new artifacts waits before listing once more.
///
/// Cursor uploads a run's artifacts as the run finishes, so the listing can
/// still be empty a moment after the terminal frame that ended the turn. The
/// trade is plain: every turn that produced nothing pays this before it
/// answers, and without it a walkthrough's screenshots are silently missing
/// from the turn that took them. Five seconds is long enough to cover the
/// upload lag seen in practice and short enough to read as the turn ending.
const ARTIFACT_LISTING_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// The largest artifact this service will pull into memory, 64 MiB.
///
/// Read from the listing's `sizeBytes`, so an oversized recording is declined
/// before a byte of it is fetched. Well past any screenshot and past most
/// screen recordings; a run that produces something bigger loses that one
/// file, loudly, rather than the process losing its memory.
const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy)]
struct IngestMode {
    emit: bool,
    strict: bool,
    attempt: usize,
}
impl IngestMode {
    const LIVE: Self = Self {
        emit: true,
        strict: false,
        attempt: 0,
    };
    const HYDRATE: Self = Self {
        emit: false,
        strict: true,
        attempt: 0,
    };
}

/// Wait out `duration`, unless the client cancels first. `true` means it did.
///
/// Every wait a turn can be parked in goes through this, so a cancel is felt
/// within a scheduler tick rather than at the end of whatever interval happened
/// to be running.
async fn sleep_unless_cancelled(
    cancel: &tokio_util::sync::CancellationToken,
    duration: std::time::Duration,
) -> bool {
    tokio::select! {
        biased;
        () = cancel.cancelled() => true,
        () = tokio::time::sleep(duration) => false,
    }
}

/// The run's content records already durable in this session's journal.
///
/// What a stream read from the beginning is reconciled against: every record
/// here must arrive again, in order, before anything new is appended. Recomputed
/// rather than captured once, because a reconnect that restarts the stream has
/// to account for what the interrupted connection already appended.
fn captured_content(
    session: &Session,
    run: &CursorRunId,
) -> Vec<crate::domain::journal::NativeRecord> {
    session
        .state
        .lock()
        .expect("session state poisoned")
        .journal_entries
        .iter()
        .filter(|entry| entry.run.as_ref() == Some(run))
        .filter_map(|entry| match &entry.input {
            JournalInput::Sse(record) if record.is_content() => Some(record.clone()),
            _ => None,
        })
        .collect()
}

/// Restate a repository rejection as something the person who prompted can
/// act on, leaving every other failure exactly as it arrived.
///
/// The result is a [`SessionError::Rejected`], so it takes the same path a
/// [`PromptRejected`](crate::domain::error::PromptRejected) already takes:
/// the prompt is journalled as aborted and the message travels to the client
/// as the `session/prompt` error. Cursor's own body stays in the tracing event —
/// it names codes and ids that mean nothing to a reader of the chip.
fn explain_repository_rejection(error: SessionError) -> SessionError {
    let SessionError::Cursor(report) = &error else {
        return error;
    };
    let Some(unavailable) =
        report.downcast_current_context::<crate::domain::error::RepositoryUnavailable>()
    else {
        return error;
    };
    tracing::warn!(
        repo = %unavailable.repo,
        reason = %unavailable.reason,
        detail = %unavailable.detail,
        "cursor rejected the prompt: it could not use the session's repository"
    );
    SessionError::Rejected(unavailable.user_message())
}

/// Whether a failed create is a definite refusal — the prompt never ran, so
/// it is journalled as aborted rather than left as an accepted turn.
fn is_prompt_rejection(error: &SessionError) -> bool {
    match error {
        SessionError::Rejected(_) => true,
        SessionError::Cursor(report) => report
            .downcast_current_context::<crate::domain::error::PromptRejected>()
            .is_some(),
        _ => false,
    }
}

/// A prompt Cursor refused before the session had an agent, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RejectedPrompt {
    /// What the person asked, as it would have gone to Cursor.
    text: String,
    /// The refusal as it was shown to them, when there was a readable one.
    reason: Option<String>,
}

/// The prompt that finally mints an agent, carrying the ones Cursor refused
/// before it so the agent reads the whole conversation the person had.
///
/// Plain text rather than structure because that is all `create_agent`
/// takes; the framing tells the agent which message is current and that the
/// earlier ones were never acted on, so it neither re-does nor ignores them.
fn prompt_with_rejected(rejected: &[RejectedPrompt], prompt: &str) -> String {
    if rejected.is_empty() {
        return prompt.to_owned();
    }
    let mut text = String::from(
        "The following earlier message(s) in this conversation never reached an agent: \
         each attempt to start one was refused by Cursor. They are included so nothing the \
         person asked is lost. The message under \"Latest message\" is the one to respond to.\n",
    );
    for earlier in rejected {
        text.push_str("\n--- Earlier message ---\n");
        text.push_str(&earlier.text);
        if let Some(reason) = &earlier.reason {
            text.push_str("\n(Refused with: ");
            text.push_str(reason);
            text.push(')');
        }
        text.push('\n');
    }
    text.push_str("\n--- Latest message ---\n");
    text.push_str(prompt);
    text
}

/// One session's mutable state. Guarded by a std mutex: every critical
/// section is a handful of field reads/writes, never an await.
#[derive(Debug, Default)]
struct SessionState {
    /// The repository this session works on, once the first prompt chose one.
    ///
    /// Mutable, and that is the point: a fresh session has no repository until
    /// its first prompt is read, and a restored one carries back whatever that
    /// prompt chose. Still needed after the agent exists - Cursor fixed the
    /// repository at creation, and a restore has to hand the same one back.
    repo: Option<RepoUrl>,
    /// The first prompt's repository decision, kept until an agent exists.
    ///
    /// Cursor can reject the create that follows the decision — a branch it
    /// could not verify, a repository the account has not connected — and the
    /// next prompt is then usually "what happened?", which is no evidence of
    /// where the work belongs. So the decision is made once, on the prompt
    /// that carried the evidence, and reused by every create attempt until
    /// one succeeds. Cleared with the process: a restored session re-decides.
    intent: Option<SessionIntent>,
    /// Prompts Cursor refused before any agent existed, oldest first.
    ///
    /// A refused prompt is journaled as aborted and never reaches Cursor; if
    /// the next one alone minted the agent, the agent would answer a question
    /// about a message it never saw. So they ride along with the prompt that
    /// finally creates it. Cancelled prompts are deliberately not here — the
    /// person withdrew those. Cleared once a prompt is accepted.
    rejected_prompts: Vec<RejectedPrompt>,
    /// The Cursor agent, once the first prompt has minted it.
    agent: Option<CursorAgentId>,
    /// The run currently streaming, so cancel knows what to cancel.
    active_run: Option<CursorRunId>,
    /// The last run this session itself drove to an end. The backfill
    /// watermark: runs newer than this were driven from cursor.com and are
    /// delivered before the next prompt. `None` means no watermark — a fresh
    /// or restored session, whose history is already rendered or unknowable —
    /// so nothing is backfilled rather than everything replayed.
    last_run: Option<CursorRunId>,
    /// Whether the ACP client has opened or loaded this session on the current
    /// connection. Restored sessions must not emit recovered updates before
    /// `session/load` re-establishes the host's routing for their session id.
    ready_for_sync: bool,
    /// Pause background capture while the host loads, without refusing prompts
    /// it already dispatched before observing the recovery requirement.
    reload_pending: bool,
    /// Set by cancel; read by the turn when its stream ends.
    ///
    /// The *verdict*, not the mechanism: a cancel that raced the stream's own
    /// ending still has to report `Cancelled`, so this outlives the token
    /// below and is what the turn consults once it has stopped.
    cancelled: bool,
    /// Fired by cancel; awaited by every wait a turn can be sitting in.
    ///
    /// The mechanism, and the reason a cancel is felt at once rather than
    /// whenever Cursor happens to end the stream. Replaced per turn, so a
    /// cancel can never carry into the next one.
    cancel: tokio_util::sync::CancellationToken,
    /// The model this session's next run will use.
    ///
    /// `None` means "whatever this user's own Cursor settings resolve to" —
    /// Cursor falls back user default, then team, then system — which is the
    /// right answer until a client says otherwise.
    model: Option<ModelChoice>,
    /// MCP servers the client named, applied when the first prompt creates
    /// the agent. Mutable because they re-enter over the protocol: a
    /// `session/load` carries the client's current list, which is the truth a
    /// restored process has no other way to learn.
    mcp_servers: Vec<McpServer>,
    /// Carried across turns so tool-call ids stay deduplicated for the whole
    /// session.
    machine: ReplayMachine,
    journal_entries: Vec<JournalEntry>,
    journal_loaded: bool,
    fresh: bool,
    capture_failed: bool,
}

/// A session shared between a streaming turn and a concurrent cancel.
#[derive(Debug)]
struct Session {
    /// ACP working directory, used by the standalone repository chooser.
    cwd: PathBuf,
    /// The model id this session was using before the process restarted, when
    /// it was restored and had one. An id rather than a [`ModelChoice`]: only
    /// the id is persisted, and its params must be re-resolved against the
    /// live model table anyway, which can have drifted across the restart.
    ///
    /// May also be a value that was never a Cursor id at all — the harness
    /// seeds its session records with a deployment slug like `claude` — so
    /// resolution tolerates a miss instead of trusting this.
    restored_model_id: Option<String>,
    /// Serializes turns against background foreign-run syncs, so a mirror of
    /// cursor.com activity never interleaves its frames with a live turn's.
    /// A prompt waits on it; a sync skips its tick instead. Never held by
    /// `cancel`, which must land while a turn is streaming.
    turn_gate: Arc<tokio::sync::Mutex<()>>,
    state: Mutex<SessionState>,
}

/// The service behind the ACP handlers.
#[derive(Debug)]
pub struct CursorSessionService<Cursor, Notifier, Chooser, Store> {
    journal: Arc<dyn CursorJournal>,
    cursor: Cursor,
    notifier: Notifier,
    chooser: Chooser,
    /// Where a turn's walkthrough files are re-hosted. A store that reports
    /// itself unavailable turns artifact collection off entirely.
    artifacts: Store,
    sessions: Mutex<HashMap<SessionId, Arc<Session>>>,
    /// Monotonic counter for minting session ids without a clock or RNG.
    next_session: Mutex<u64>,
    /// A model id this deployment pins, applied to every new session. `None`
    /// leaves the choice to Cursor's own default resolution.
    default_model_id: Option<String>,
    /// `GET /v1/models`, fetched once. The table is static for the life of a
    /// process and every `session/new` would otherwise re-fetch it.
    models: tokio::sync::Mutex<Option<Vec<CursorModel>>>,
}

impl<Cursor, Notifier, Chooser, Store> CursorSessionService<Cursor, Notifier, Chooser, Store>
where
    Cursor: CursorAgents + CursorArtifacts + RunStream,
    Notifier: SessionNotifier,
    Chooser: RepositoryChooser,
    Store: ArtifactStore,
{
    /// Wire the service to its ports.
    pub fn new(
        cursor: Cursor,
        notifier: Notifier,
        chooser: Chooser,
        journal: Arc<dyn CursorJournal>,
        artifacts: Store,
    ) -> Self {
        Self {
            journal,
            cursor,
            notifier,
            chooser,
            artifacts,
            sessions: Mutex::new(HashMap::new()),
            next_session: Mutex::new(0),
            default_model_id: None,
            models: tokio::sync::Mutex::new(None),
        }
    }
    /// Pin the model every new session starts on, by id.
    ///
    /// The id alone, because a caller configuring this has only ever had an id
    /// to give (`CURSOR_MODEL`); its params are resolved from Cursor's own
    /// default variant, since Cursor rejects an id whose params are not a
    /// variant it knows.
    #[must_use]
    pub fn with_default_model(mut self, model_id: Option<String>) -> Self {
        self.default_model_id = model_id;
        self
    }

    /// Open a session.
    ///
    /// No repository is chosen here: a session's repository follows from what
    /// its first prompt asks for, and there is no prompt yet. `session/new`
    /// carries a `cwd`, which the standalone chooser uses to resolve its checkout.
    /// Hosted sessions choose from the prompt and ignore that path.
    pub fn new_session(&self, cwd: &Path, mcp_servers: Vec<McpServer>) -> SessionId {
        let session = Arc::new(Session {
            cwd: cwd.to_path_buf(),
            restored_model_id: None,
            turn_gate: Arc::new(tokio::sync::Mutex::new(())),
            state: Mutex::new(SessionState {
                mcp_servers,
                ready_for_sync: true,
                fresh: true,
                ..SessionState::default()
            }),
        });
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        // Counter-minted ids restart at 1 each process, but restored sessions
        // carry ids minted by earlier processes — skip over those rather than
        // silently replacing a live session with a fresh one.
        let id = loop {
            let candidate = {
                let mut next = self.next_session.lock().expect("session counter poisoned");
                *next += 1;
                SessionId::new(format!("cursor-acp-{next}"))
            };
            if !sessions.contains_key(&candidate) {
                break candidate;
            }
        };
        sessions.insert(id.clone(), session);
        id
    }

    /// The models this account may choose from, fetched once and reused.
    pub async fn models(&self) -> Result<Vec<CursorModel>, SessionError> {
        let mut cached = self.models.lock().await;
        if let Some(models) = cached.as_ref() {
            return Ok(models.clone());
        }
        let models = self
            .cursor
            .list_models()
            .await
            .map_err(SessionError::Cursor)?;
        *cached = Some(models.clone());
        Ok(models)
    }

    /// The model a session's next run will use, by id.
    ///
    /// This is what *we* last asked for, not what Cursor ran: no API surface
    /// reports a run's model back — not the run record, not the run list, not
    /// the stream — so our own record is the only answer available.
    pub async fn session_model_id(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<String>, SessionError> {
        Ok(self
            .effective_model(session_id)
            .await?
            .map(|model| model.id))
    }

    /// Choose the model a session's next run will use.
    ///
    /// Takes effect on the next run rather than the one streaming now, which
    /// Cursor fixes at creation. Resolved against `GET /v1/models` so an id
    /// Cursor would reject is refused here, with the list, instead of failing
    /// at the next prompt.
    pub async fn set_model(
        &self,
        session_id: &SessionId,
        model_id: &str,
    ) -> Result<(), SessionError> {
        let session = self.session(session_id)?;
        let models = self.models().await?;
        let model = models
            .iter()
            .find(|model| model.id == model_id)
            .ok_or_else(|| {
                SessionError::Cursor(rootcause::report!(
                    "no cursor model with id {model_id}; this account offers {}",
                    models
                        .iter()
                        .map(|model| model.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
            })?;
        session.state.lock().expect("session state poisoned").model = Some(model.default_choice());
        Ok(())
    }

    /// The session's explicit choice, or the deployment's pinned default
    /// resolved to a variant Cursor will accept.
    ///
    /// The default is resolved on first use rather than at `session/new`, which
    /// is synchronous and cannot reach the API, and then stored so the lookup
    /// happens once per session.
    async fn effective_model(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<ModelChoice>, SessionError> {
        let session = self.session(session_id)?;
        if let Some(model) = session
            .state
            .lock()
            .expect("session state poisoned")
            .model
            .clone()
        {
            return Ok(Some(model));
        }
        // The restored id outranks the deployment default: it is what this
        // session was actually using before the restart, and the default is
        // what a session gets when nobody ever said otherwise.
        let fallback_id = session
            .restored_model_id
            .as_deref()
            .or(self.default_model_id.as_deref());
        let Some(fallback_id) = fallback_id else {
            return Ok(None);
        };
        // A failure to *fetch* the model table degrades like a failed lookup
        // in it: the fallback is a preference, and Cursor being unreachable
        // for `GET /v1/models` must cost the preference, never the prompt —
        // the run itself may well still work.
        let choice = match self.resolve_model_id(fallback_id).await {
            Ok(choice) => choice,
            Err(error) => {
                tracing::warn!(
                    fallback_id,
                    %error,
                    "could not resolve the fallback model; using Cursor's default"
                );
                None
            }
        };
        let Some(choice) = choice else {
            return Ok(None);
        };
        session.state.lock().expect("session state poisoned").model = Some(choice.clone());
        Ok(Some(choice))
    }

    /// The id resolved to a choice Cursor will accept, or `None` for an id
    /// this account is not offered.
    ///
    /// The miss is tolerated by design, not defensively. Both fallback ids
    /// come from places that can legitimately hold non-Cursor values: the
    /// deployment default is operator configuration, and the restored id is a
    /// persisted column the harness seeds with its own deployment slug
    /// (`claude`) before any real choice overwrites it. For either, "not a
    /// Cursor model" means "no opinion" — Cursor's own default resolution is a
    /// working answer — never a failed prompt.
    async fn resolve_model_id(&self, model_id: &str) -> Result<Option<ModelChoice>, SessionError> {
        let models = self.models().await?;
        let Some(model) = models.iter().find(|model| model.id == model_id) else {
            tracing::warn!(
                model_id,
                "not a cursor model this account is offered; using Cursor's default"
            );
            return Ok(None);
        };
        Ok(Some(model.default_choice()))
    }

    /// Replace the session's MCP servers with the client's current list.
    ///
    /// Driven by `session/load`: the list belongs to the client and the
    /// protocol restates it there, which is how a restored process — whose
    /// host never persisted it — learns it again.
    pub fn set_mcp_servers(&self, session_id: &SessionId, mcp_servers: Vec<McpServer>) {
        if let Ok(session) = self.session(session_id) {
            session
                .state
                .lock()
                .expect("session state poisoned")
                .mcp_servers = mcp_servers;
        }
    }

    /// Mark a restored session safe for background updates after load replies.
    #[cfg(test)]
    fn loaded(&self, session_id: &SessionId) -> Result<(), SessionError> {
        let session = self.session(session_id)?;
        session
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .ready_for_sync = true;
        Ok(())
    }

    /// Run one prompt to completion, delivering updates as they stream.
    ///
    /// Resolves with the turn's ACP stop reason once the run's stream ends.
    #[tracing::instrument(skip(self, prompt), err)]
    pub async fn prompt(
        &self,
        session_id: &SessionId,
        prompt: &str,
    ) -> Result<StopReason, SessionError> {
        self.prompt_content(
            session_id,
            prompt,
            vec![ContentBlock::Text(TextContent::new(prompt))],
        )
        .await
    }

    /// Run a prompt retaining its original ACP blocks in the native journal.
    ///
    /// This is the whole of a Cursor turn, and the ACP path calls straight
    /// through here rather than through [`Self::prompt`] - so an
    /// uninstrumented body leaves a turn with no span at all.
    ///
    /// The outcome is recorded on the way out rather than left to `err`.
    /// A turn whose future is dropped - a pipe torn down under it - still
    /// closes its span, with no error and no recorded outcome, which is
    /// otherwise indistinguishable from a turn that ended normally. An unset
    /// `agent.turn.outcome` is what tells those two apart.
    #[tracing::instrument(
        name = "agent.turn",
        skip_all,
        fields(
            agent.acp.session_id = ?session_id,
            cursor.agent.id = tracing::field::Empty,
            cursor.run.id = tracing::field::Empty,
            agent.turn.stop_reason = tracing::field::Empty,
            agent.turn.outcome = tracing::field::Empty,
        ),
        err,
    )]
    pub async fn prompt_content(
        &self,
        session_id: &SessionId,
        prompt: &str,
        blocks: Vec<ContentBlock>,
    ) -> Result<StopReason, SessionError> {
        let outcome = self.run_turn(session_id, prompt, blocks).await;
        let span = tracing::Span::current();
        match &outcome {
            Ok(stop_reason) => {
                span.record("agent.turn.stop_reason", tracing::field::debug(stop_reason));
                span.record("agent.turn.outcome", "completed");
            }
            Err(_) => {
                span.record("agent.turn.outcome", "failed");
            }
        }
        outcome
    }

    async fn run_turn(
        &self,
        session_id: &SessionId,
        prompt: &str,
        blocks: Vec<ContentBlock>,
    ) -> Result<StopReason, SessionError> {
        let session = self.session(session_id)?;
        // Wait behind an in-flight foreign-run mirror, so its frames and
        // this turn's never interleave — but never behind another turn: ACP
        // makes a concurrent prompt the client's error, not a queue. The
        // holder is told apart by active_run, which only turns set.
        let _turn = match session.turn_gate.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                if session
                    .state
                    .lock()
                    .expect("session state poisoned")
                    .active_run
                    .is_some()
                {
                    return Err(SessionError::TurnAlreadyActive(session_id.clone()));
                }
                session.turn_gate.lock().await
            }
        };

        if !session
            .state
            .lock()
            .expect("session state poisoned")
            .ready_for_sync
        {
            return Err(SessionError::Cursor(rootcause::report!(
                "Cursor session must load successfully before prompting"
            )));
        }
        // This pending prompt owns cancellation before any model lookup or
        // historical recovery can wait. Recovery cannot clear a received stop.
        let cancel = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.cancelled = false;
            state.cancel = tokio_util::sync::CancellationToken::new();
            state.cancel.clone()
        };
        // A failed model lookup proves no prompt was executed. Do it before
        // reserving the durable intent, so load does not see false ambiguity.
        let model = self.effective_model(session_id).await?;
        self.ensure_journal(session_id, &session).await?;
        let prior_agent = session
            .state
            .lock()
            .expect("session state poisoned")
            .agent
            .clone();
        if let Some(agent) = &prior_agent {
            self.backfill_foreign_runs(session_id, &session, agent, None)
                .await?;
        }
        // Preserve original content before the provider creates remote work.
        self.capture(
            session_id,
            &session,
            None,
            JournalInput::Prompt(blocks.clone()),
            false,
        )
        .await?;

        let prompt_sequence = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .last()
            .expect("captured prompt")
            .sequence;

        if cancel.is_cancelled() {
            self.capture(
                session_id,
                &session,
                None,
                JournalInput::PromptAborted(prompt_sequence),
                false,
            )
            .await?;
            return Ok(StopReason::Cancelled);
        }

        let creating_agent = prior_agent.is_none();
        let created = match prior_agent {
            Some(agent) => {
                // Queue behind any run still going (the same agent advances
                // from cursor.com too) instead of failing the prompt.
                self.create_run_when_free(&session, &agent, prompt, model.as_ref(), &cancel)
                    .await
                    .map(|run| (agent, run))
            }
            None => {
                // Snapshotted out of the lock: `create_agent` is a network
                // call, and the state mutex must never be held across an await.
                let (mcp_servers, decided, rejected) = {
                    let state = session.state.lock().expect("session state poisoned");
                    (
                        state.mcp_servers.clone(),
                        state.intent.clone(),
                        state.rejected_prompts.clone(),
                    )
                };
                // The first prompt is the only evidence there is for which
                // repository this session belongs to, and Cursor fixes an
                // agent's repository at creation - so the decision is made
                // here, before the agent exists, and never revisited: a
                // create Cursor refused leaves the decision standing for the
                // next attempt rather than re-reading a prompt that is now
                // about the refusal.
                let intent = match decided {
                    Some(intent) => {
                        tracing::info!(
                            repo = ?intent.repository.as_ref().map(RepoUrl::as_str),
                            "reusing the repository decided by this session's first prompt"
                        );
                        Ok(intent)
                    }
                    None => self.chooser.choose(prompt, &session.cwd).await,
                };
                match intent {
                    Ok(intent) => {
                        {
                            let mut state = session.state.lock().expect("session state poisoned");
                            state.repo = intent.repository.clone();
                            state.intent = Some(intent.clone());
                        }
                        if intent.repository.is_none() {
                            tracing::warn!(
                                "no repository chosen - this session will not appear in the Cursor sessions list"
                            );
                        }
                        self.cursor
                            .create_agent(
                                &prompt_with_rejected(&rejected, prompt),
                                intent.repository.as_ref(),
                                intent.open_pull_request,
                                &mcp_servers,
                                model.as_ref(),
                            )
                            .await
                            .map_err(SessionError::from)
                    }
                    // A chooser that cannot answer fails the prompt rather
                    // than falling back to some default repository: an agent
                    // minted against the wrong repository would open its pull
                    // request there, which no later correction undoes.
                    Err(error) => {
                        tracing::warn!(error = ?error, "could not choose a repository for this session");
                        Err(SessionError::Rejected(
                            "Couldn't prepare repository access for this session. Please retry; if this persists, check your GitHub connection."
                                .to_owned(),
                        ))
                    }
                }
            }
        };
        let (agent, run) = match created.map_err(explain_repository_rejection) {
            Ok(created) => created,
            Err(error) => {
                if is_prompt_rejection(&error) {
                    self.capture(
                        session_id,
                        &session,
                        None,
                        JournalInput::PromptAborted(prompt_sequence),
                        false,
                    )
                    .await?;
                    if cancel.is_cancelled() {
                        return Ok(StopReason::Cancelled);
                    }
                    // Only a create's refusal is carried: a follow-up run
                    // refused on an existing agent is already in a conversation
                    // the agent can see.
                    if creating_agent {
                        let reason = match &error {
                            SessionError::Rejected(message) => Some(message.clone()),
                            _ => None,
                        };
                        session
                            .state
                            .lock()
                            .expect("session state poisoned")
                            .rejected_prompts
                            .push(RejectedPrompt {
                                text: prompt.to_owned(),
                                reason,
                            });
                    }
                }
                return Err(error);
            }
        };
        self.capture(
            session_id,
            &session,
            Some(&run),
            JournalInput::PromptAccepted(prompt_sequence),
            false,
        )
        .await?;
        {
            let mut state = session.state.lock().expect("session state poisoned");
            state.agent = Some(agent.clone());
            state.rejected_prompts.clear();
        }
        // Acceptance is durable even if recovery of an older run fails. Do
        // not observe/project the new run until every older run is reconciled.
        self.backfill_foreign_runs(session_id, &session, &agent, Some(&run))
            .await?;
        // The turn span is the only place all three identities meet, and it
        // is what makes a Macro session joinable to the cursor.com run that
        // served it.
        let span = tracing::Span::current();
        span.record("cursor.agent.id", tracing::field::display(&agent));
        span.record("cursor.run.id", tracing::field::display(&run));
        tracing::info!(%agent, %run, "cursor run started");
        let cancelled_before_the_run = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.agent = Some(agent.clone());
            state.active_run = Some(run.clone());
            state.cancelled
        };
        // A stop this run did not exist to receive. `cancel` had no run id to
        // POST — a first prompt spends ten seconds creating the agent, and a
        // session with no agent yet cannot name one — so the remote work was
        // left going and the stream below would have read it to the agent's
        // own natural end. Ask now, and the same stream ends on Cursor's
        // cancelled `result` a second or two later.
        if cancelled_before_the_run {
            tracing::info!(%agent, %run, "stop arrived before this run existed; cancelling it now");
            if let Err(error) = self.cursor.cancel_run(&agent, &run).await {
                // Best-effort, exactly as in `cancel`: the turn still ends on
                // whatever the stream reports.
                tracing::warn!(%agent, %run, %error, "could not cancel a run stopped before it existed");
            }
        }

        let outcome = self
            .stream_turn(session_id, &session, &agent, &run, &cancel)
            .await;

        let cancelled = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.active_run = None;
            state.cancelled
        };
        // Both variants are a turn that stopped without a terminal fact, and
        // both have to leave that record: a `Rejected` here is the turn giving
        // up on a run still going, not a prompt refused before it ran.
        let interrupted = match &outcome {
            Err(SessionError::Cursor(error)) => Some(error.to_string()),
            Err(SessionError::Rejected(message)) => Some(message.clone()),
            _ => None,
        };
        if let Some(interrupted) = interrupted {
            self.capture(
                session_id,
                &session,
                Some(&run),
                JournalInput::Interrupted(interrupted),
                true,
            )
            .await?;
        }
        if cancelled && outcome.is_ok() {
            self.capture(
                session_id,
                &session,
                Some(&run),
                JournalInput::Interrupted("user cancelled the turn".into()),
                true,
            )
            .await?;
        }
        // The run's walkthrough files, collected once its outcome is known
        // and before the turn answers, so the fold appends their markdown to
        // this turn's reply like any other streamed text. A failed turn
        // collects nothing: there is no reply for the text to land in.
        if outcome.is_ok() {
            self.collect_artifacts(session_id, &session, &agent, &run, &cancel)
                .await?;
        }
        let reconciled = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .iter()
            .any(|e| e.run.as_ref() == Some(&run) && e.input == JournalInput::Reconciled);
        if outcome.is_ok() && reconciled {
            self.notifier
                .checkpoint(session_id, &run)
                .await
                .map_err(SessionError::Cursor)?;
            session
                .state
                .lock()
                .expect("session state poisoned")
                .last_run = Some(run.clone());
        }
        // A cancel that raced the stream's own ending still reports
        // Cancelled: ACP requires it once the client sent `session/cancel`.
        // `Rejected` included, because giving up on a run still going takes
        // that variant now — a stop landing near the end of the poll budget
        // must still answer Cancelled, not "Cursor is still working". Journal
        // failures stay unmasked by cancellation, as ever.
        match outcome {
            Ok(_) | Err(SessionError::Cursor(_) | SessionError::Rejected(_)) if cancelled => {
                Ok(StopReason::Cancelled)
            }
            Ok(stop_reason) => Ok(stop_reason),
            Err(error) => Err(error),
        }
    }

    /// Cancel the session's active turn, if any. Idempotent; a session with
    /// no active turn is a no-op rather than an error, because the turn may
    /// have ended while the cancel was in flight.
    ///
    /// `active_run` is this process's own memory of what it started, so it is
    /// empty for a session restored after a restart — or one whose run this
    /// process never drove at all (started from cursor.com). Either way the
    /// agent may still have a run going, so a miss falls back to asking
    /// Cursor which run, if any, is current before giving up on the remote
    /// cancel.
    #[tracing::instrument(skip(self), err)]
    pub async fn cancel(&self, session_id: &SessionId) -> Result<(), SessionError> {
        let session = self.session(session_id)?;
        let (agent, active_run) = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.cancelled = true;
            // Unblocks a prompt still queued behind `agent_busy`. The live
            // stream is not abandoned — Cursor's `result` frame is what ends
            // the turn. The POST below is the notification that asks for that
            // frame.
            state.cancel.cancel();
            (state.agent.clone(), state.active_run.clone())
        };
        // No agent yet: the session's first prompt is still creating one, so
        // there is nothing to name in a remote cancel. `cancelled` is set,
        // and `prompt` sends it as soon as the run has an id.
        let Some(agent) = agent else {
            return Ok(());
        };
        let runs = match active_run {
            Some(run) => vec![run],
            None => self.current_runs(&agent).await,
        };
        // Concurrent rather than sequential so one failing cancel does not
        // skip the rest — every run found gets its own attempt regardless of
        // how the others land.
        let results =
            futures::future::join_all(runs.iter().map(|run| self.cursor.cancel_run(&agent, run)))
                .await;
        for result in results {
            result?;
        }
        Ok(())
    }

    /// The agent's runs still in progress, per Cursor's own record.
    ///
    /// The fallback [`Self::cancel`] takes when this process has no memory of
    /// one: best-effort, like the remote cancel itself, so a lookup failure
    /// costs the remote cancel, never the local one that already fired.
    /// Cursor documents one active run per agent (see
    /// [`Self::create_run_when_free`]), but that is a server-side invariant
    /// this client does not enforce, so every match is cancelled rather than
    /// just the first — cheap insurance against it ever slipping.
    async fn current_runs(&self, agent: &CursorAgentId) -> Vec<CursorRunId> {
        let listings = match self.cursor.list_runs(agent, None).await {
            Ok(listings) => listings,
            Err(error) => {
                tracing::warn!(%agent, %error, "could not list runs to find one to cancel");
                return Vec::new();
            }
        };
        let runs: Vec<CursorRunId> = listings
            .into_iter()
            .filter(|listing| matches!(listing.status, RunStatus::Creating | RunStatus::Running))
            .map(|listing| listing.id)
            .collect();
        if runs.len() > 1 {
            tracing::warn!(
                %agent,
                count = runs.len(),
                "more than one run in progress for an agent; Cursor documents one active run per agent"
            );
        }
        runs
    }

    /// Drop a session, reporting whether it existed. Any active run keeps
    /// running server-side; closing the ACP session does not imply
    /// cancelling the work.
    ///
    /// The bool is what lets `session/close` answer a client that named a
    /// session this agent never had, rather than acknowledging a no-op.
    pub fn close(&self, session_id: &SessionId) -> bool {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .remove(session_id)
            .is_some()
    }

    /// Seed a session a previous process created, so a `session/load` naming
    /// it finds it live.
    ///
    /// The host restores provider identity; the Cursor-owned journal restores
    /// conversation state when the client subsequently loads the session. With
    /// `Some(agent)` the next prompt opens a follow-up run on that agent;
    /// with `None` it mints a fresh one — the state of a session that died
    /// after `session/new` but before its first prompt, which must still
    /// load rather than refuse (seen live: a restart in that window left a
    /// session no follow-up could ever reach). Replaces any session already
    /// under `id`: the restored fact wins, and the id space cannot collide
    /// with fresh ids because [`Self::new_session`] skips occupied ids.
    pub fn restore_session(
        &self,
        id: SessionId,
        agent: Option<CursorAgentId>,
        repo: Option<RepoUrl>,
        model_id: Option<String>,
    ) {
        self.restore_session_with_watermark(id, agent, repo, model_id, None);
    }

    /// Restore a session together with its durable run-delivery checkpoint.
    pub fn restore_session_with_watermark(
        &self,
        id: SessionId,
        agent: Option<CursorAgentId>,
        repo: Option<RepoUrl>,
        model_id: Option<String>,
        last_run: Option<CursorRunId>,
    ) {
        // No MCP servers here on purpose: the host never had the truth to
        // hand over — the list belongs to the ACP client, and the client
        // restates it on `session/load`, which is where it re-enters.
        let session = Arc::new(Session {
            cwd: PathBuf::new(),
            restored_model_id: model_id,
            turn_gate: Arc::new(tokio::sync::Mutex::new(())),
            state: Mutex::new(SessionState {
                repo,
                agent,
                last_run,
                ..SessionState::default()
            }),
        });
        self.sessions
            .lock()
            .expect("session map poisoned")
            .insert(id, session);
    }

    /// Whether a session is live in this process. What `session/load` checks:
    /// loading is a lookup, not a fetch, because restoring state into the
    /// process is [`Self::restore_session`]'s job and happens before serving.
    #[must_use]
    pub fn has_session(&self, session_id: &SessionId) -> bool {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .contains_key(session_id)
    }

    /// Stream one run, translating and delivering as events arrive.
    ///
    /// Streaming is the good path, not the only one. Cursor's stream endpoint
    /// has been observed refusing connects for seconds after a run's creation
    /// and dying mid-run, while the run itself finishes fine server-side — so
    /// any streaming failure here degrades to the polling fallback rather than
    /// failing the turn. A turn may lose its liveness; it must not lose its
    /// answer.
    async fn stream_turn(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<StopReason, SessionError> {
        self.ingest_run(session_id, session, agent, run, cancel, IngestMode::LIVE)
            .await
    }

    /// One ordered path for live, foreign, and hydration ingestion. Reconnect
    /// starts at the beginning and verifies the captured content prefix. No
    /// local sequence is sent to Cursor as a remote resume token.
    ///
    /// One span per ingestion attempt: this is where a turn or a replay spends
    /// its time between the run being listed and its records being journaled,
    /// and the Cursor stream and poll calls inside it are what a stalled
    /// handshake or turn was otherwise waiting on invisibly.
    #[tracing::instrument(
        name = "cursor.run.ingest",
        skip_all,
        fields(
            agent.acp.session_id = ?session_id,
            cursor.agent.id = %agent,
            cursor.run.id = %run,
            cursor.ingest.emit = mode.emit,
            cursor.ingest.strict = mode.strict,
            cursor.ingest.attempt = mode.attempt,
            cursor.stream.reconnects = tracing::field::Empty,
            cursor.stream.fell_back_to_poll = tracing::field::Empty,
        ),
        err,
    )]
    async fn ingest_run(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        cancel: &tokio_util::sync::CancellationToken,
        mode: IngestMode,
    ) -> Result<StopReason, SessionError> {
        let IngestMode {
            emit,
            strict,
            attempt,
        } = mode;
        // A crash can leave a terminal SSE/Poll durable but its following
        // marker absent. Its text and terminal tool cleanup were reconstructed
        // already; reconnecting the stream would append that suffix twice.
        let terminal = session
            .state
            .lock()
            .expect("session state poisoned")
            .machine
            .terminal_status(run);
        if let Some(status) = terminal {
            if strict
                && !session
                    .state
                    .lock()
                    .expect("session state poisoned")
                    .machine
                    .has_prompt(run)
            {
                return Err(
                    rootcause::report!("original Cursor prompt unavailable for {run}").into(),
                );
            }
            self.capture(
                session_id,
                session,
                Some(run),
                JournalInput::Reconciled,
                false,
            )
            .await?;
            return match status {
                RunStatus::Cancelled => Ok(StopReason::Cancelled),
                RunStatus::Finished => Ok(StopReason::EndTurn),
                _ if strict => Ok(StopReason::EndTurn),
                status => Err(rootcause::report!("cursor run {run} ended in {status:?}").into()),
            };
        }
        let mut captured = captured_content(session, run);
        let mut matched = 0;
        let mut terminal = None;
        let mut saw_content = false;
        // The provider's most recent event id. Opaque: it is handed back
        // verbatim as a resume position or not used at all.
        let mut last_event_id: Option<String> = None;
        // Reconnects since the last one that produced new records.
        let mut reconnects: u32 = 0;
        let mut fell_back_to_poll = false;
        let mut ever_connected = false;
        let mut resume_from: Option<String> = None;
        // Cursor rejecting a resume position buys exactly one connect without
        // one; a second rejection means something is wrong with the run, not
        // with the id we sent.
        let mut blind_reconnect_available = true;
        // The run's latest `status` frame, kept to recognize the sticky copy
        // Cursor re-sends at the top of every reconnect.
        let mut last_status: Option<crate::domain::journal::NativeRecord> = None;
        loop {
            // The connected stream borrows the position it resumed from, so
            // the position this iteration sends is its own owned copy.
            let resuming = resume_from.clone();
            let interruption = match self
                .cursor
                .raw_stream(agent, run, resuming.as_deref())
                .await
            {
                Err(StreamConnectError::InvalidResumePosition(detail))
                    if blind_reconnect_available && resuming.is_some() =>
                {
                    // Reading the run from the top still beats polling: the
                    // prefix logic below matches what is already captured
                    // instead of duplicating it. It has to be recomputed
                    // first, because this ingestion has appended to it.
                    blind_reconnect_available = false;
                    tracing::warn!(
                        cursor.run.id = %run,
                        cursor.stream.last_event_id = resuming,
                        cursor.stream.reason = %detail,
                        "Cursor rejected the stream resume position; reconnecting from the start"
                    );
                    resume_from = None;
                    captured = captured_content(session, run);
                    matched = 0;
                    continue;
                }
                // Past the retention window there is no stream left to resume,
                // so the run record is the only remaining account of the run.
                Err(StreamConnectError::Expired(detail)) => Some((detail, false)),
                Err(error) => Some((error.to_string(), true)),
                Ok(connected) => {
                    let resumed = resuming.is_some();
                    ever_connected = true;
                    let retention_seconds = connected.retention_seconds;
                    let records = connected.records;
                    pin_mut!(records);
                    let mut received = 0usize;
                    let mut received_content = 0usize;
                    let mut sticky_status_pending = resumed;
                    let interruption = loop {
                        let record = match tokio::time::timeout(
                            STREAM_QUIET_TIMEOUT,
                            records.next(),
                        )
                        .await
                        {
                            Ok(Some(Ok(record))) => record,
                            Ok(Some(Err(error))) => break Some((error.to_string(), true)),
                            // Cursor closes the stream after `done`, which
                            // breaks below with an outcome. Reaching here
                            // without one is a close mid-run.
                            Ok(None) if terminal.is_some() => break None,
                            Ok(None) => break Some(("stream closed".to_owned(), true)),
                            Err(_) if strict => break None,
                            Err(_) => {
                                // Quiet streams are checked through the exact same raw
                                // polling/capture path as disconnected streams.
                                let status = self
                                    .poll_once(session_id, session, agent, run, cancel, emit)
                                    .await?;
                                if status.is_terminal() {
                                    terminal = Some(status.status);
                                    break None;
                                }
                                if cancel.is_cancelled() {
                                    break None;
                                }
                                // Cursor heartbeats an open stream, so a
                                // gap this long on a run that has not
                                // ended is a connection that stopped
                                // delivering rather than an agent thinking.
                                break Some((
                                    format!(
                                        "no records for {} seconds",
                                        STREAM_QUIET_TIMEOUT.as_secs()
                                    ),
                                    true,
                                ));
                            }
                        };
                        if let Some(id) = &record.id {
                            last_event_id = Some(id.clone());
                        }
                        // Cursor re-sends the run's `status` frame, without an
                        // id, at the top of every reconnect. It is framing, not
                        // a new fact: journaling it again would put the same
                        // lifecycle event in the record twice.
                        if std::mem::take(&mut sticky_status_pending)
                            && record.id.is_none()
                            && last_status.as_ref() == Some(&record)
                        {
                            continue;
                        }
                        if record.event == "status" {
                            last_status = Some(record.clone());
                        }
                        received += 1;
                        let content = record.is_content();
                        if content && matched < captured.len() {
                            if captured[matched] != record {
                                return Err(rootcause::report!("Cursor stream prefix cannot be reconciled for {run}; refusing incomplete history").into());
                            }
                            matched += 1;
                            if let CursorEvent::Result { status, .. } = record.decode() {
                                terminal = Some(status);
                            }
                            continue;
                        }
                        self.capture(
                            session_id,
                            session,
                            Some(run),
                            JournalInput::Sse(record.clone()),
                            emit,
                        )
                        .await?;
                        saw_content |= content;
                        received_content += usize::from(content);
                        match record.decode() {
                            CursorEvent::Error { code, .. }
                                if code.as_deref() == Some("stream_unavailable")
                                    && !saw_content
                                    && attempt < 4 =>
                            {
                                if !sleep_unless_cancelled(
                                    cancel,
                                    std::time::Duration::from_millis(400),
                                )
                                .await
                                {
                                    return Box::pin(self.ingest_run(
                                        session_id,
                                        session,
                                        agent,
                                        run,
                                        cancel,
                                        IngestMode {
                                            attempt: attempt + 1,
                                            ..mode
                                        },
                                    ))
                                    .await;
                                }
                                break None;
                            }
                            CursorEvent::Result { status, .. } => terminal = Some(status),
                            // The stream's own account of the run's lifecycle, and a
                            // terminal one is a terminal fact even with no `result`
                            // frame behind it. Observed live: a run whose record
                            // stayed `RUNNING` with a frozen `updatedAt` announced
                            // `FINISHED` here and sent no `result` at all, so a turn
                            // that accepted only `result` waited out its whole poll
                            // budget against a record that was never going to move.
                            //
                            // Not a break: trailing content can still be in flight,
                            // and `done`, the stream's end, or a quiet gap closes the
                            // turn now that there is an outcome to close it with.
                            CursorEvent::Status { status, .. } if status.is_terminal() => {
                                terminal = Some(status);
                            }
                            // Cursor said its piece about this run; a fresh
                            // connection would only be told the same thing.
                            CursorEvent::Error { .. } => break None,
                            CursorEvent::Done => break None,
                            _ => {}
                        }
                    };
                    if resumed {
                        tracing::info!(
                            cursor.run.id = %run,
                            cursor.stream.attempt = reconnects,
                            cursor.stream.last_event_id = last_event_id,
                            cursor.stream.retention_seconds = retention_seconds,
                            cursor.stream.resumed_records = received,
                            "Cursor stream resumed"
                        );
                        // A resume that delivered is a working stream again,
                        // so the next drop gets the full budget rather than
                        // whatever a much earlier one left over.
                        if received_content > 0 {
                            reconnects = 0;
                        }
                    }
                    interruption
                }
            };
            let Some((reason, recoverable)) = interruption else {
                break;
            };
            fell_back_to_poll = true;
            if !ever_connected {
                // Nothing to resume: the stream never opened, and the client
                // has already retried an unavailable one on its own.
                self.capture(
                    session_id,
                    session,
                    Some(run),
                    JournalInput::TransportError(reason.clone()),
                    emit,
                )
                .await?;
                tracing::warn!(
                    cursor.run.id = %run,
                    cursor.stream.reason = %reason,
                    "Cursor stream never connected; polling the run record instead"
                );
                break;
            }
            let attempt = reconnects + 1;
            self.capture(
                session_id,
                session,
                Some(run),
                JournalInput::StreamInterrupted {
                    reason: reason.clone(),
                    last_event_id: last_event_id.clone(),
                    attempt,
                },
                emit,
            )
            .await?;
            // Hydration verifies the whole captured prefix against a stream it
            // reads from the beginning, which a resumed stream cannot offer.
            let resumable = recoverable && !strict && attempt <= STREAM_RECONNECT_ATTEMPTS as u32;
            if !resumable {
                tracing::warn!(
                    cursor.run.id = %run,
                    cursor.stream.last_event_id = last_event_id,
                    cursor.stream.attempt = attempt,
                    cursor.stream.reason = %reason,
                    "Cursor stream is not resumable; polling the run record instead"
                );
                break;
            }
            tracing::warn!(
                cursor.run.id = %run,
                cursor.stream.last_event_id = last_event_id,
                cursor.stream.attempt = attempt,
                cursor.stream.reason = %reason,
                "Cursor stream interrupted; reconnecting"
            );
            let delay = STREAM_RECONNECT_DELAYS
                [(attempt as usize - 1).min(STREAM_RECONNECT_DELAYS.len() - 1)];
            if sleep_unless_cancelled(cancel, delay).await {
                break;
            }
            reconnects = attempt;
            resume_from = last_event_id.clone();
            fell_back_to_poll = false;
        }
        let span = tracing::Span::current();
        span.record("cursor.stream.reconnects", reconnects);
        span.record("cursor.stream.fell_back_to_poll", fell_back_to_poll);
        if matched < captured.len() && strict {
            return Err(rootcause::report!(
                "Cursor no longer exposes the captured stream prefix for {run}"
            )
            .into());
        }
        if terminal.is_none() {
            if strict {
                return Err(rootcause::report!(
                    "Cursor cannot fully hydrate run {run}: complete native stream unavailable"
                )
                .into());
            }
            for attempt in 0..POLL_ATTEMPTS {
                if attempt > 0 && cancel.is_cancelled() {
                    self.capture(
                        session_id,
                        session,
                        Some(run),
                        JournalInput::Interrupted("cancelled while disconnected".into()),
                        emit,
                    )
                    .await?;
                    return Ok(StopReason::Cancelled);
                }
                match self
                    .poll_once(session_id, session, agent, run, cancel, emit)
                    .await
                {
                    Ok(outcome) if outcome.is_terminal() => {
                        terminal = Some(outcome.status);
                        break;
                    }
                    Ok(_) => {}
                    Err(error) => {
                        // Journal/processing failures must never be retried as
                        // provider errors; poll_once distinguishes them.
                        return Err(error);
                    }
                }
                sleep_unless_cancelled(cancel, POLL_INTERVAL).await;
            }
        }
        let Some(status) = terminal else {
            // Not a failure to describe in provider terms: the run is still
            // going as far as Cursor is concerned, and this turn has simply
            // run out of patience. The person who prompted gets told that in
            // their own words; the diagnostics stay in the span.
            tracing::warn!(
                %run,
                attempts = POLL_ATTEMPTS,
                "gave up waiting; Cursor still reports a non-terminal status"
            );
            return Err(SessionError::Rejected(
                "Cursor has not reported a result for this run, and has stopped saying \
                 anything about it. Prompting again starts fresh and abandons this run."
                    .into(),
            ));
        };
        if strict
            && !session
                .state
                .lock()
                .expect("session state poisoned")
                .machine
                .complete(run)
        {
            return Err(rootcause::report!(
                "Cursor cannot hydrate the original prompt for run {run}"
            )
            .into());
        }
        // A disconnected cancel did not get here: reconciliation is only
        // marked after a real provider terminal fact, never on ACP delivery.
        self.capture(
            session_id,
            session,
            Some(run),
            JournalInput::Reconciled,
            emit,
        )
        .await?;
        if strict {
            return Ok(StopReason::EndTurn);
        }
        match status {
            RunStatus::Finished => Ok(StopReason::EndTurn),
            RunStatus::Cancelled => Ok(StopReason::Cancelled),
            status => Err(rootcause::report!("cursor run {run} ended in {status:?}").into()),
        }
    }

    /// One poll of a running turn.
    ///
    /// Named explicitly so a rename of the client method underneath cannot
    /// silently take the span with it: this loop is the only continuous
    /// heartbeat a Cursor turn has, and a turn that stops polling is the
    /// first evidence that something took it down.
    ///
    /// `debug` because the loop runs every [`POLL_INTERVAL`]; the turn span
    /// above carries the outcome, this carries the liveness.
    #[tracing::instrument(
        name = "cursor.run.poll",
        level = "debug",
        skip_all,
        fields(
            agent.acp.session_id = ?session_id,
            cursor.agent.id = %agent,
            cursor.run.id = %run,
            cursor.run.status = tracing::field::Empty,
        ),
        err,
    )]
    async fn poll_once(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        cancel: &tokio_util::sync::CancellationToken,
        emit: bool,
    ) -> Result<crate::domain::model::RunOutcome, SessionError> {
        let mut raw = None;
        for attempt in 0..=POLL_ERROR_TOLERANCE {
            match self.cursor.raw_result(agent, run).await {
                Ok(value) => {
                    raw = Some(value);
                    break;
                }
                Err(error) if attempt == POLL_ERROR_TOLERANCE => return Err(error.into()),
                Err(error) => {
                    tracing::warn!(error = ?error, "Cursor poll failed; retrying");
                    if sleep_unless_cancelled(cancel, POLL_INTERVAL).await {
                        return Err(SessionError::Cursor(error));
                    }
                }
            }
        }
        let raw = raw.expect("poll returned or failed");
        self.capture(
            session_id,
            session,
            Some(run),
            JournalInput::Poll(raw.clone()),
            emit,
        )
        .await?;
        let value: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| rootcause::report!(e).into_dynamic())?;
        Ok(crate::domain::model::RunOutcome {
            status: serde_json::from_value(value["status"].clone())
                .map_err(|e| rootcause::report!(e).into_dynamic())?,
            text: value
                .get("result")
                .or_else(|| value.get("text"))
                .and_then(|s| s.as_str())
                .map(str::to_owned),
        })
    }

    /// Create a follow-up run, waiting out whatever run is already going.
    ///
    /// Cursor allows one active run per agent and answers `agent_busy`
    /// otherwise — and the other run is not necessarily ours, because the
    /// agent's page on cursor.com drives the same agent. The session's
    /// contract with its callers is a queue, so a busy agent is something to
    /// wait behind, not an error. A client cancel abandons the wait.
    async fn create_run_when_free(
        &self,
        session: &Session,
        agent: &CursorAgentId,
        prompt: &str,
        model: Option<&ModelChoice>,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<CursorRunId, SessionError> {
        let mut released = false;
        for _ in 0..BUSY_ATTEMPTS {
            if cancel.is_cancelled() {
                return Err(SessionError::Cursor(
                    rootcause::report!(crate::domain::error::PromptRejected(
                        "the prompt was cancelled while waiting for the agent to be free".into()
                    ))
                    .into_dynamic(),
                ));
            }
            match self.cursor.create_run(agent, prompt, model).await {
                Ok(run) => return Ok(run),
                Err(error) if error.to_string().contains("agent_busy") => {
                    // A run this session already gave up on still holds the
                    // agent's single run slot, and it is not going to release
                    // it by itself — waiting out the full budget would only
                    // fail the prompt slower. Cancelling is terminal on
                    // Cursor's side, so it frees the agent and gives the
                    // abandoned run the terminal fact it needs to reconcile.
                    // Done once: a run that is merely slow, or one driven from
                    // cursor.com, is still something to wait behind.
                    if !std::mem::replace(&mut released, true) {
                        self.release_abandoned_runs(session, agent).await;
                        continue;
                    }
                    tracing::info!(%agent, "agent busy (a run is active, possibly from cursor.com); waiting");
                    if sleep_unless_cancelled(cancel, POLL_INTERVAL).await {
                        return Err(SessionError::Cursor(
                            rootcause::report!(crate::domain::error::PromptRejected(
                                "the prompt was cancelled while waiting for the agent to be free"
                                    .into()
                            ))
                            .into_dynamic(),
                        ));
                    }
                }
                Err(error) => return Err(SessionError::Cursor(error)),
            }
        }
        Err(SessionError::Cursor(
            rootcause::report!(crate::domain::error::PromptRejected(format!(
                "the agent stayed busy for {} seconds",
                BUSY_ATTEMPTS as u64 * POLL_INTERVAL.as_secs()
            )))
            .into_dynamic(),
        ))
    }

    /// The runs a turn in this session already stopped waiting for.
    ///
    /// A journal fact, not a guess: a run recorded as
    /// [`JournalInput::Interrupted`] and never reconciled is one a turn gave
    /// up on. That is the only class of run this service may cancel or
    /// decline to recover — a run merely still going, including one driven
    /// from cursor.com, is someone's live conversation.
    fn abandoned_runs(session: &Session) -> Vec<CursorRunId> {
        let state = session.state.lock().expect("session state poisoned");
        let reconciled: std::collections::HashSet<_> = state
            .journal_entries
            .iter()
            .filter(|e| e.input == JournalInput::Reconciled)
            .filter_map(|e| e.run.clone())
            .collect();
        let mut abandoned = Vec::new();
        for run in state
            .journal_entries
            .iter()
            .filter(|e| matches!(e.input, JournalInput::Interrupted(_)))
            .filter_map(|e| e.run.as_ref())
        {
            if !reconciled.contains(run) && !abandoned.contains(run) {
                abandoned.push(run.clone());
            }
        }
        abandoned
    }

    /// Cancel the runs this session abandoned, freeing the agent's run slot.
    ///
    /// Cancellation is terminal on Cursor's side, so this both returns the
    /// agent's single run slot and gives the abandoned run the terminal fact
    /// it needs before it can ever reconcile.
    ///
    /// Best effort. A cancel that fails leaves the caller exactly where it
    /// was, waiting out the busy agent, so there is nothing here to fail on.
    async fn release_abandoned_runs(&self, session: &Session, agent: &CursorAgentId) {
        for run in Self::abandoned_runs(session) {
            match self.cursor.cancel_run(agent, &run).await {
                Ok(()) => {
                    tracing::info!(%agent, %run, "cancelled an abandoned run holding the agent");
                }
                Err(error) => {
                    tracing::warn!(%agent, %run, %error, "could not cancel an abandoned run");
                }
            }
        }
    }

    /// Catch up foreign runs through the same journal path as local prompts.
    async fn backfill_foreign_runs(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        current_run: Option<&CursorRunId>,
    ) -> Result<bool, SessionError> {
        self.ensure_journal(session_id, session).await?;
        let last = session
            .state
            .lock()
            .expect("session state poisoned")
            .last_run
            .clone();
        // Full provider order is needed when an accepted newer run is
        // waiting behind an older failed backfill. Include journal-pending runs
        // even AT/BEFORE the delivered watermark, which is not a capture cursor.
        let listings = self.cursor.list_runs(agent, None).await?;
        let (pending, reconciled) = {
            let state = session.state.lock().expect("session state poisoned");
            let reconciled: std::collections::HashSet<_> = state
                .journal_entries
                .iter()
                .filter(|e| e.input == JournalInput::Reconciled)
                .filter_map(|e| e.run.clone())
                .collect();
            let mut pending = Vec::new();
            for run in state.journal_entries.iter().filter_map(|e| e.run.as_ref()) {
                if !reconciled.contains(run) && !pending.contains(run) {
                    pending.push(run.clone());
                }
            }
            (pending, reconciled)
        };
        let newer: std::collections::HashSet<_> = listings
            .iter()
            .take_while(|r| Some(&r.id) != last.as_ref())
            .map(|r| r.id.clone())
            .collect();
        // A run a turn already gave up on, which Cursor still has not ended,
        // is not recoverable history: there is no terminal fact to reconcile
        // against, and re-reading it cannot manufacture one. Retrying it here
        // would fail every later prompt for as long as the run stays
        // unfinished — which, when the provider wedges a run at `RUNNING`, is
        // forever. Left pending instead, to be mirrored in once it does end.
        //
        // Deliberately not every unfinished run: one still going that no turn
        // has abandoned — a prompt sent from cursor.com — is exactly what this
        // backfill exists to stream in, and must still be followed.
        let abandoned = Self::abandoned_runs(session);
        let unfinished: std::collections::HashSet<_> = listings
            .iter()
            .filter(|r| !r.status.is_terminal() && abandoned.contains(&r.id))
            .map(|r| r.id.clone())
            .collect();
        let mut runs = Vec::new();
        // A pending run omitted by the provider listing still has to recover.
        for run in &pending {
            if !listings.iter().any(|r| &r.id == run) && current_run != Some(run) {
                runs.push(run.clone());
            }
        }
        for listing in listings.into_iter().rev() {
            if current_run != Some(&listing.id)
                && (pending.contains(&listing.id) || newer.contains(&listing.id))
            {
                runs.push(listing.id);
            }
        }
        runs.retain(|run| !unfinished.contains(run));
        let mirrored = !runs.is_empty();
        for run in &runs {
            if !reconciled.contains(run) {
                // A cancelled prior prompt must not cancel its recovery.
                self.ingest_run(
                    session_id,
                    session,
                    agent,
                    run,
                    &tokio_util::sync::CancellationToken::new(),
                    IngestMode {
                        emit: false,
                        ..IngestMode::LIVE
                    },
                )
                .await?;
            }
            let complete = session
                .state
                .lock()
                .expect("session state poisoned")
                .journal_entries
                .iter()
                .any(|e| e.run.as_ref() == Some(run) && e.input == JournalInput::Reconciled);
            if !complete {
                return Err(rootcause::report!("Cursor run {run} remains unreconciled").into());
            }
        }
        if mirrored {
            let notify = {
                let mut state = session.state.lock().expect("session state poisoned");
                if let Err(error) =
                    history_projection(&state.journal_entries, HistoryGap::DeclinesReplacement)
                {
                    tracing::warn!(error = ?error, %session_id, "captured recovery cannot replace history yet");
                    return Ok(mirrored);
                }
                !std::mem::replace(&mut state.reload_pending, true)
            };
            if notify {
                self.notifier
                    .require_reload(session_id)
                    .await
                    .inspect_err(|_| {
                        session
                            .state
                            .lock()
                            .expect("session state poisoned")
                            .reload_pending = false;
                    })?;
            }
        }
        Ok(mirrored)
    }

    /// Re-host the walkthrough files this run produced and say so in the
    /// turn's own text.
    ///
    /// Artifacts never fail a turn: a listing that cannot be read, a file
    /// that cannot be fetched or stored, is reported and skipped, and the
    /// prompt still answers with the run's stop reason. Only a journal
    /// failure propagates, and that is already fatal to the session by the
    /// time it is seen here.
    #[tracing::instrument(
        name = "cursor.artifacts.collect",
        skip_all,
        fields(
            cursor.agent.id = %agent,
            artifacts.known = tracing::field::Empty,
            artifacts.collected = tracing::field::Empty,
            artifacts.retried = tracing::field::Empty,
        ),
    )]
    async fn collect_artifacts(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(), SessionError> {
        if !self.artifacts.is_available() {
            return Ok(());
        }
        let span = tracing::Span::current();
        // Every earlier collection in this session, because the provider's
        // listing is agent-scoped and repeats everything older turns wrote.
        let known: std::collections::HashSet<String> = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .iter()
            .filter_map(|entry| match &entry.input {
                JournalInput::ArtifactsCollected(artifacts) => Some(artifacts),
                _ => None,
            })
            .flatten()
            .map(|artifact| artifact.key.clone())
            .collect();
        span.record("artifacts.known", known.len());

        let Some(mut fresh) = self.new_artifacts(agent, &known).await else {
            return Ok(());
        };
        let retried = fresh.is_empty();
        span.record("artifacts.retried", retried);
        if retried {
            // A cancelled turn skips the wait and lists once more anyway:
            // `sleep_unless_cancelled` returns immediately, and the second
            // listing is the cheap half of this.
            sleep_unless_cancelled(cancel, ARTIFACT_LISTING_RETRY_DELAY).await;
            let Some(second) = self.new_artifacts(agent, &known).await else {
                return Ok(());
            };
            fresh = second;
        }
        if fresh.is_empty() {
            return Ok(());
        }

        let mut collected = Vec::new();
        for listing in fresh {
            if listing.size_bytes > MAX_ARTIFACT_BYTES {
                tracing::warn!(
                    artifact.path = %listing.path,
                    artifact.size_bytes = listing.size_bytes,
                    artifact.size_limit = MAX_ARTIFACT_BYTES,
                    "skipping an artifact larger than this service will buffer"
                );
                continue;
            }
            let fetched = match self.cursor.fetch_artifact(agent, &listing.path).await {
                Ok(fetched) => fetched,
                Err(error) => {
                    tracing::warn!(
                        artifact.path = %listing.path,
                        %error,
                        "could not fetch an artifact from Cursor"
                    );
                    continue;
                }
            };
            let mime_type = mime_type(listing.name(), fetched.content_type.as_deref());
            match self
                .artifacts
                .store(listing.name(), &mime_type, fetched.bytes)
                .await
            {
                Ok(uri) => collected.push(CollectedArtifact {
                    key: listing.key(),
                    name: listing.name().to_owned(),
                    mime_type,
                    uri,
                    size_bytes: listing.size_bytes,
                }),
                Err(error) => tracing::warn!(
                    artifact.path = %listing.path,
                    %error,
                    "could not re-host an artifact"
                ),
            }
        }
        span.record("artifacts.collected", collected.len());
        if collected.is_empty() {
            return Ok(());
        }
        tracing::info!(
            %agent,
            %run,
            artifacts.collected = collected.len(),
            "re-hosted this run's artifacts"
        );
        // Journalled and projected in one step, which is what puts the
        // markdown on the wire: capture appends before it emits, so a crash
        // between the two re-announces on replay instead of losing files
        // whose provider links have since expired.
        self.capture(
            session_id,
            session,
            Some(run),
            JournalInput::ArtifactsCollected(collected),
            true,
        )
        .await
    }

    /// The agent's artifacts this session has not collected yet, oldest
    /// first. `None` means the listing itself failed and the turn carries on.
    async fn new_artifacts(
        &self,
        agent: &CursorAgentId,
        known: &std::collections::HashSet<String>,
    ) -> Option<Vec<ArtifactListing>> {
        let listings = match self.cursor.list_artifacts(agent).await {
            Ok(listings) => listings,
            Err(error) => {
                tracing::warn!(%agent, %error, "could not list this agent's artifacts");
                return None;
            }
        };
        let mut fresh: Vec<_> = listings
            .into_iter()
            .filter(|listing| !known.contains(&listing.key()))
            .collect();
        // Write order, as far as the provider's timestamps show it, so a
        // walkthrough's screenshots read in the order they were taken.
        fresh.sort_by(|left, right| {
            (&left.updated_at, &left.path).cmp(&(&right.updated_at, &right.path))
        });
        Some(fresh)
    }

    async fn ensure_journal(&self, id: &SessionId, session: &Session) -> Result<(), SessionError> {
        if session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_loaded
        {
            return Ok(());
        }
        let entries = self.journal.read(id).await?;
        let mut machine = ReplayMachine::default();
        for entry in &entries {
            // An entry that will not project is skipped rather than failed.
            // It is already durable, so failing here fails identically every
            // time this session is read, and a session whose journal cannot
            // be read cannot be loaded or prompted ever again.
            if let Err(error) = project_entry(&mut machine, entry, &entries) {
                tracing::warn!(
                    %error,
                    sequence = entry.sequence,
                    "skipping a Cursor journal entry that will not project"
                );
            }
        }
        let fresh = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.journal_entries = entries;
            state.machine = machine;
            state.journal_loaded = true;
            state.fresh
        };
        if fresh {
            self.capture(id, session, None, JournalInput::HistoryComplete, false)
                .await?;
            session.state.lock().expect("session state poisoned").fresh = false;
        }
        Ok(())
    }

    /// The only route from provider input to translation and notifications.
    /// Every caller holds the turn gate, including load/hydration and sync.
    async fn capture(
        &self,
        id: &SessionId,
        session: &Session,
        run: Option<&CursorRunId>,
        input: JournalInput,
        emit: bool,
    ) -> Result<(), SessionError> {
        let (expected, duplicate) = {
            let state = session.state.lock().expect("session state poisoned");
            if state.capture_failed {
                return Err(SessionError::Journal(rootcause::report!(
                    "reload required after native journal failure"
                )));
            }
            (
                state.journal_entries.last().map_or(0, |e| e.sequence),
                matches!(input, JournalInput::Poll(_))
                    && state
                        .journal_entries
                        .last()
                        .is_some_and(|e| e.run.as_ref() == run && e.input == input),
            )
        };
        if duplicate {
            return Ok(());
        }
        let entry = self
            .journal
            .append(id, expected, run, &input)
            .await
            .map_err(|error| {
                let mut state = session.state.lock().expect("session state poisoned");
                state.capture_failed = true;
                state.ready_for_sync = false;
                SessionError::Journal(error)
            })?;
        let (updates, completion, pull_request) = {
            let mut state = session.state.lock().expect("session state poisoned");
            let previous_pr = state.machine.pull_request_url().map(str::to_owned);
            let before = run.and_then(|run| state.machine.terminal_status(run));
            state.journal_entries.push(entry.clone());
            let SessionState {
                machine,
                journal_entries,
                ..
            } = &mut *state;
            let updates = match project_entry(machine, &entry, journal_entries) {
                Ok(updates) => updates,
                Err(error) => {
                    state.capture_failed = true;
                    state.ready_for_sync = false;
                    return Err(SessionError::Journal(error));
                }
            };
            // Local active prompts finish through their correlated response.
            // A recovered tail has no pending response, so publish its fact.
            let completion = if before.is_none() && run != state.active_run.as_ref() {
                run.and_then(|run| state.machine.terminal_status(run))
                    .map(turn_outcome)
            } else {
                None
            };
            let pull_request = state
                .machine
                .pull_request_url()
                .filter(|url| Some(*url) != previous_pr.as_deref())
                .map(str::to_owned);
            (updates, completion, pull_request)
        };
        if emit {
            if let Some(url) = pull_request {
                self.notifier
                    .set_pull_request(id, &url)
                    .await
                    .map_err(|error| {
                        let mut state = session.state.lock().expect("session state poisoned");
                        state.capture_failed = true;
                        state.ready_for_sync = false;
                        SessionError::Journal(error)
                    })?;
            }
            // The live prompt request already carries these original blocks.
            // Replay projects them at the run boundary; live must not echo them.
            let local_prompt = run.is_some_and(|run| {
                let state = session.state.lock().expect("session state poisoned");
                state.active_run.as_ref() == Some(run)
                    && state.journal_entries.iter().any(|e| {
                        e.run.as_ref() == Some(run)
                            && matches!(e.input, JournalInput::PromptAccepted(_))
                    })
            });
            for update in updates {
                if local_prompt && matches!(update, SessionUpdate::UserMessageChunk(_)) {
                    continue;
                }
                self.notifier.notify(id, update).await.map_err(|error| {
                    let mut state = session.state.lock().expect("session state poisoned");
                    state.capture_failed = true;
                    state.ready_for_sync = false;
                    SessionError::Journal(error)
                })?;
            }
            if let Some(outcome) = completion {
                self.notifier
                    .turn_complete(id, outcome)
                    .await
                    .map_err(|error| {
                        let mut state = session.state.lock().expect("session state poisoned");
                        state.capture_failed = true;
                        state.ready_for_sync = false;
                        SessionError::Journal(error)
                    })?;
            }
        }
        Ok(())
    }

    /// Fill in prompts the journal never captured, from Cursor's own record.
    ///
    /// A run driven from cursor.com and mirrored here after its stream aged
    /// out has an answer and no question: the stream is the only thing that
    /// carries the opening message, and the run record left behind does not.
    /// The conversation endpoint outlives both, so it is asked once per load
    /// that has a gap, and what it recovers is journaled - a prompt written
    /// exactly as a live one is, so it projects into place rather than onto
    /// the end of the transcript, and so the next load needs no lookup.
    ///
    /// Best effort throughout. Every failure here leaves the gap exactly as
    /// it was, which the load already serves.
    async fn recover_lost_prompts(
        &self,
        id: &SessionId,
        session: &Session,
        agent: Option<&CursorAgentId>,
    ) {
        let Some(agent) = agent else {
            return;
        };
        let lost = {
            let state = session.state.lock().expect("session state poisoned");
            runs_without_prompts(&state.journal_entries, &state.machine)
                .into_iter()
                .filter_map(|run| {
                    state
                        .machine
                        .answer(run)
                        .filter(|answer| !answer.is_empty())
                        .map(|answer| (run.clone(), answer.to_owned()))
                })
                .collect::<Vec<_>>()
        };
        if lost.is_empty() {
            return;
        }
        let conversation = match self.cursor.conversation(agent).await {
            Ok(conversation) => conversation,
            Err(error) => {
                tracing::warn!(%error, %agent, "could not read the Cursor conversation");
                return;
            }
        };
        for (run, answer) in lost {
            let Some(prompt) = prompt_for_answer(&conversation, &answer) else {
                tracing::warn!(%run, "no Cursor conversation line names this run's prompt");
                continue;
            };
            let blocks = vec![ContentBlock::Text(TextContent::new(prompt))];
            if let Err(error) = self
                .capture(id, session, None, JournalInput::Prompt(blocks), false)
                .await
            {
                tracing::warn!(%error, %run, "could not journal a recovered Cursor prompt");
                return;
            }
            let sequence = session
                .state
                .lock()
                .expect("session state poisoned")
                .journal_entries
                .last()
                .expect("captured prompt")
                .sequence;
            if let Err(error) = self
                .capture(
                    id,
                    session,
                    Some(&run),
                    JournalInput::PromptAccepted(sequence),
                    false,
                )
                .await
            {
                tracing::warn!(%error, %run, "could not link a recovered Cursor prompt");
                return;
            }
            tracing::info!(%run, "recovered a lost Cursor prompt from the conversation");
        }
    }

    /// Reconstruct the entire session before allowing a successful load reply.
    /// The returned guard serializes the reply itself with every live writer.
    ///
    /// The runtime-side counterpart of the harness's handshake span: a
    /// `session/load` that times out upstream is spent in here.
    #[tracing::instrument(
        name = "cursor.session.replay",
        skip(self),
        fields(agent.acp.session_id = ?id),
        err,
    )]
    pub async fn replay_session(&self, id: &SessionId) -> Result<ReplayGuard, SessionError> {
        let session = self.session(id)?;
        let gate = Arc::clone(&session.turn_gate).lock_owned().await;
        {
            let mut state = session.state.lock().expect("session state poisoned");
            state.ready_for_sync = false;
            state.journal_loaded = false;
            state.capture_failed = false;
        }
        self.ensure_journal(id, &session).await?;
        let (agent, complete) = {
            let state = session.state.lock().expect("session state poisoned");
            (
                state.agent.clone(),
                state
                    .journal_entries
                    .iter()
                    .any(|e| e.input == JournalInput::HistoryComplete),
            )
        };
        // Old sessions are only safe when every run can still be fetched in
        // full (including its original user message), not just final answers.
        if !complete {
            if let Some(agent) = &agent {
                let listings = self.cursor.list_runs(agent, None).await?;
                if listings.is_empty() {
                    return Err(rootcause::report!(
                        "Cursor history unavailable for restored session"
                    )
                    .into());
                }
                for listing in listings.into_iter().rev() {
                    let captured = {
                        let state = session.state.lock().expect("session state poisoned");
                        state.machine.complete(&listing.id)
                            && state.journal_entries.iter().any(|e| {
                                e.run.as_ref() == Some(&listing.id)
                                    && e.input == JournalInput::Reconciled
                            })
                    };
                    if captured {
                        continue;
                    }
                    self.ingest_run(
                        id,
                        &session,
                        agent,
                        &listing.id,
                        &tokio_util::sync::CancellationToken::new(),
                        IngestMode::HYDRATE,
                    )
                    .await?;
                }
            }
            self.capture(id, &session, None, JournalInput::HistoryComplete, false)
                .await?;
        }
        // Before projecting, not after: a prompt recovered here closes the gap
        // rather than merely surviving it, and lands in the transcript this
        // load is about to publish.
        self.recover_lost_prompts(id, &session, agent.as_ref())
            .await;
        let entries = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .clone();
        // A gap here cannot be allowed to fail the load. The runtime reattaches
        // to a disconnected session by loading it, so a load that refuses is
        // also every future prompt refused as disconnected, with no way back.
        let (machine, updates) = history_projection(&entries, HistoryGap::IsServedAnyway)?;
        if let Some(url) = machine.pull_request_url() {
            self.notifier.set_pull_request(id, url).await?;
        }
        for (batch, outcome) in updates {
            for update in batch {
                self.notifier.notify(id, update).await?;
            }
            if let Some(outcome) = outcome {
                self.notifier.turn_complete(id, outcome).await?;
            }
        }
        if let Some(run) = entries.iter().rev().find_map(|entry| {
            (entry.input == JournalInput::Reconciled)
                .then_some(entry.run.as_ref())
                .flatten()
        }) {
            self.notifier.checkpoint(id, run).await?;
            session
                .state
                .lock()
                .expect("session state poisoned")
                .last_run = Some(run.clone());
        }
        session
            .state
            .lock()
            .expect("session state poisoned")
            .machine = machine;
        Ok(ReplayGuard {
            session,
            _gate: gate,
        })
    }

    /// Mirror cursor.com activity into every live session, once.
    ///
    /// The host calls this on a timer while a session's transport is up, so
    /// the cursor.com half of a conversation appears here within a tick of
    /// happening rather than waiting for the next Macro prompt. A session
    /// mid-turn is skipped (the turn gate is held). Failures are logged per
    /// session and never stop the sweep.
    pub async fn sync_foreign_runs(&self) {
        let sessions: Vec<(SessionId, Arc<Session>)> = self
            .sessions
            .lock()
            .expect("session map poisoned")
            .iter()
            .map(|(id, session)| (id.clone(), Arc::clone(session)))
            .collect();
        for (session_id, session) in sessions {
            let Ok(_turn) = session.turn_gate.try_lock() else {
                continue;
            };
            let agent = {
                let state = session.state.lock().expect("session state poisoned");
                (state.ready_for_sync && !state.reload_pending)
                    .then(|| state.agent.clone())
                    .flatten()
            };
            let Some(agent) = agent else {
                continue;
            };
            if let Err(error) = self
                .backfill_foreign_runs(&session_id, &session, &agent, None)
                .await
            {
                tracing::warn!(%session_id, %agent, %error, "could not mirror cursor.com runs");
            }
        }
    }

    /// Whether any session is currently executing a turn.
    ///
    /// Hosts use this to distinguish a genuinely idle connection from one
    /// whose provider is still working without producing client updates.
    #[must_use]
    pub fn has_active_turn(&self) -> bool {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .values()
            .any(|session| session.turn_gate.try_lock().is_err())
    }

    fn session(&self, id: &SessionId) -> Result<Arc<Session>, SessionError> {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| SessionError::UnknownSession(id.clone()))
    }
}

/// Holds the session writer gate through queuing the ACP load response.
pub struct ReplayGuard {
    session: Arc<Session>,
    _gate: tokio::sync::OwnedMutexGuard<()>,
}
impl ReplayGuard {
    /// Enable continuation only after the response was successfully queued.
    pub fn complete(self) {
        let mut state = self.session.state.lock().expect("session state poisoned");
        state.ready_for_sync = true;
        state.reload_pending = false;
    }
}

fn replay_input(
    entry: &JournalEntry,
    entries: &[JournalEntry],
) -> Result<JournalInput, rootcause::Report> {
    match entry.input {
        JournalInput::PromptAccepted(sequence) => entries
            .iter()
            .find(|e| e.sequence == sequence && e.run.is_none())
            .map(|e| e.input.clone())
            .ok_or_else(|| rootcause::report!("missing original Cursor prompt").into_dynamic()),
        _ => Ok(entry.input.clone()),
    }
}

/// Project conversational facts independently of pre-execution intent order.
fn project_entry(
    machine: &mut ReplayMachine,
    entry: &JournalEntry,
    entries: &[JournalEntry],
) -> Result<Vec<SessionUpdate>, rootcause::Report> {
    if matches!(entry.input, JournalInput::PromptAccepted(_))
        || (entry.run.is_none() && matches!(entry.input, JournalInput::Prompt(_)))
    {
        return Ok(Vec::new());
    }
    let mut updates = Vec::new();
    if let Some(run) = &entry.run
        && !machine.has_prompt(run)
        && let Some(accepted) = entries.iter().find(|e| {
            e.run.as_ref() == Some(run) && matches!(e.input, JournalInput::PromptAccepted(_))
        })
    {
        updates.extend(machine.push(Some(run), &replay_input(accepted, entries)?)?);
    }
    if let JournalInput::PromptAborted(sequence) = entry.input
        && let Some(intent) = entries.iter().find(|e| e.sequence == sequence)
    {
        updates.extend(machine.push(None, &intent.input)?);
    }
    updates.extend(machine.push(entry.run.as_ref(), &entry.input)?);
    Ok(updates)
}

fn turn_outcome(status: RunStatus) -> agent_runtime_protocol::domain::turn::TurnOutcome {
    use agent_runtime_protocol::domain::turn::TurnOutcome;
    match status {
        RunStatus::Finished => TurnOutcome::Finished,
        RunStatus::Cancelled => TurnOutcome::Cancelled,
        status => TurnOutcome::Failed {
            message: format!("Agent run ended in {status:?}"),
        },
    }
}

type HistoryUpdates = Vec<(
    Vec<SessionUpdate>,
    Option<agent_runtime_protocol::domain::turn::TurnOutcome>,
)>;

/// Runs the journal holds frames for but no opening prompt.
///
/// The same condition [`history_projection`] reports a gap on, named once so
/// recovery looks for exactly what the projection would complain about.
fn runs_without_prompts<'a>(
    entries: &'a [JournalEntry],
    machine: &ReplayMachine,
) -> Vec<&'a CursorRunId> {
    let mut missing: Vec<&CursorRunId> = Vec::new();
    for run in entries.iter().filter_map(|e| e.run.as_ref()) {
        if missing.contains(&run) || machine.has_prompt(run) {
            continue;
        }
        let accepted_only = entries
            .iter()
            .filter(|e| e.run.as_ref() == Some(run))
            .all(|e| matches!(e.input, JournalInput::PromptAccepted(_)));
        if !accepted_only {
            missing.push(run);
        }
    }
    missing
}

/// The prompt that produced `answer`, if the conversation says so plainly.
///
/// Anchored on the answer the journal already holds rather than on position:
/// Cursor's conversation carries no run ids, and its turn numbering does not
/// track the run list once runs are cancelled or fail. An answer that appears
/// more than once names no single turn - an agent that replied the same thing
/// twice is ordinary - so an ambiguous match yields nothing rather than a
/// guess. Attaching the wrong question to an answer is worse than leaving the
/// question blank, which is all a gap costs now.
fn prompt_for_answer<'a>(conversation: &'a [ConversationLine], answer: &str) -> Option<&'a str> {
    let mut spoken = conversation
        .iter()
        .enumerate()
        .filter(|(_, line)| line.speaker == ConversationSpeaker::Agent && line.text == answer);
    let (at, _) = spoken.next()?;
    if spoken.next().is_some() {
        return None;
    }
    conversation[..at]
        .iter()
        .rev()
        .find(|line| line.speaker == ConversationSpeaker::User)
        .map(|line| line.text.as_str())
}

/// What a gap in the recovered history costs the caller asking for it.
///
/// Replacing a session's conversation is a choice, and a candidate missing a
/// turn's opening is worse than the history already on screen, so a gap
/// declines the replacement and what is there stands.
///
/// Loading is not a choice. The journal is the only history there is, and a
/// load that refuses leaves a session that cannot be opened and cannot be
/// prompted - the runtime reattaches by loading, so every later prompt is
/// refused as disconnected too. A gap is reported and the rest is served.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HistoryGap {
    DeclinesReplacement,
    IsServedAnyway,
}

/// Whether `run` collects artifacts after `entry`, so its turn outcome has to
/// wait for them.
fn collects_artifacts_later(
    entries: &[JournalEntry],
    entry: &JournalEntry,
    run: &CursorRunId,
) -> bool {
    entries.iter().any(|later| {
        later.sequence > entry.sequence
            && later.run.as_ref() == Some(run)
            && matches!(later.input, JournalInput::ArtifactsCollected(_))
    })
}

fn history_projection(
    entries: &[JournalEntry],
    gap: HistoryGap,
) -> Result<(ReplayMachine, HistoryUpdates), SessionError> {
    for entry in entries {
        if entry.run.is_none()
            && matches!(entry.input, JournalInput::Prompt(_))
            && !entries.iter().any(|e| {
                matches!(e.input, JournalInput::PromptAccepted(n) | JournalInput::PromptAborted(n) if n == entry.sequence)
            })
        {
            if gap == HistoryGap::IsServedAnyway {
                tracing::warn!(
                    sequence = entry.sequence,
                    "serving Cursor history whose prompt was never resolved"
                );
                break;
            }
            return Err(rootcause::report!("Cursor prompt acceptance is unknown; refusing incomplete replacement history").into());
        }
    }
    let mut machine = ReplayMachine::default();
    // Validate the whole candidate before publishing even its first frame.
    // Intent position is audit order, not conversation order. Accepted
    // prompts project immediately before their first native run input.
    let mut updates = Vec::new();
    // Turn outcomes held back past their run's terminal frame, keyed by run;
    // see the artifact case below.
    let mut deferred: HashMap<CursorRunId, agent_runtime_protocol::domain::turn::TurnOutcome> =
        HashMap::new();
    for entry in entries {
        let before = entry
            .run
            .as_ref()
            .and_then(|run| machine.terminal_status(run));
        let projected = project_entry(&mut machine, entry, entries)?;
        let terminal = entry
            .run
            .as_ref()
            .and_then(|run| machine.terminal_status(run));
        let outcome = if matches!(entry.input, JournalInput::PromptAborted(_)) {
            Some(agent_runtime_protocol::domain::turn::TurnOutcome::Cancelled)
        } else if before.is_none() {
            terminal.map(turn_outcome)
        } else {
            None
        };
        // A run's artifacts are collected after its terminal frame but belong
        // to the turn that produced them, and live delivery only ends the
        // turn when the prompt answers - after that text. Holding the outcome
        // back to the artifacts entry is what makes a reloaded session read
        // in the same order the person watched it arrive.
        let outcome = match (entry.run.as_ref(), outcome) {
            (Some(run), Some(outcome)) if collects_artifacts_later(entries, entry, run) => {
                deferred.insert(run.clone(), outcome);
                None
            }
            (Some(run), None) if matches!(entry.input, JournalInput::ArtifactsCollected(_)) => {
                deferred.remove(run)
            }
            (_, outcome) => outcome,
        };
        updates.push((projected, outcome));
    }
    // Acceptance can be durable before the first stream observation. Its
    // prompt belongs at the unfinished tail, after captured older runs.
    // If an older tail is still incomplete, defer the queued prompt until
    // recovery reaches its run; it must not steal the older turn boundary.
    for entry in entries {
        if let JournalInput::PromptAccepted(_) = entry.input
            && let Some(run) = &entry.run
            && !machine.has_prompt(run)
            && !entries
                .iter()
                .filter_map(|e| e.run.as_ref())
                .any(|other| other != run && machine.has_prompt(other) && !machine.complete(other))
        {
            updates.push((
                machine.push(Some(run), &replay_input(entry, entries)?)?,
                None,
            ));
        }
    }
    for run in entries.iter().filter_map(|e| e.run.as_ref()) {
        let accepted_only = entries
            .iter()
            .filter(|e| e.run.as_ref() == Some(run))
            .all(|e| matches!(e.input, JournalInput::PromptAccepted(_)));
        if !machine.has_prompt(run) && !accepted_only {
            if gap == HistoryGap::IsServedAnyway {
                // The run's own frames are already projected; only the line
                // that opened it is missing. Serving the turn without it
                // beats serving nothing, forever.
                tracing::warn!(%run, "serving Cursor history without a run's original prompt");
                continue;
            }
            return Err(rootcause::report!(
                "Cursor original prompt unavailable for {run}; preserving existing history"
            )
            .into());
        }
    }
    Ok((machine, updates))
}
