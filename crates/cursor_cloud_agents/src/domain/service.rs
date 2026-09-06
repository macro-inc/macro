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

use crate::domain::error::SessionError;
use crate::domain::event::CursorEvent;
use crate::domain::journal::{CursorJournal, JournalEntry, JournalInput, ReplayMachine};
use crate::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl, RunStatus,
};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use agent_client_protocol::schema::v1::{
    ContentBlock, SessionId, SessionUpdate, StopReason, TextContent,
};
use futures::StreamExt as _;
use futures::pin_mut;
use std::collections::HashMap;
use std::path::Path;
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

/// How long a prompt waits behind a run something else started (the same
/// agent is drivable from cursor.com) before giving up, in poll intervals.
const BUSY_ATTEMPTS: usize = 450;

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

/// One session's mutable state. Guarded by a std mutex: every critical
/// section is a handful of field reads/writes, never an await.
#[derive(Debug, Default)]
struct SessionState {
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
    /// Resolved when the session opened; used when the first prompt creates
    /// the agent.
    repo: Option<RepoUrl>,
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
pub struct CursorSessionService<Cursor, Notifier, Repos> {
    journal: Arc<dyn CursorJournal>,
    cursor: Cursor,
    notifier: Notifier,
    repos: Repos,
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

impl<Cursor, Notifier, Repos> CursorSessionService<Cursor, Notifier, Repos>
where
    Cursor: CursorAgents + RunStream,
    Notifier: SessionNotifier,
    Repos: RepoResolver,
{
    /// Wire the service to its ports.
    pub fn new(
        cursor: Cursor,
        notifier: Notifier,
        repos: Repos,
        journal: Arc<dyn CursorJournal>,
    ) -> Self {
        Self {
            journal,
            cursor,
            notifier,
            repos,
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

    /// Open a session for a client working at `cwd`.
    ///
    /// The repository is resolved now rather than at first prompt so the
    /// warning about an unlisted (repo-less) session surfaces at `session/new`
    /// time, when the user can still do something about it.
    pub fn new_session(&self, cwd: &Path, mcp_servers: Vec<McpServer>) -> SessionId {
        let repo = self.repos.resolve(cwd);
        if repo.is_none() {
            tracing::warn!(
                cwd = %cwd.display(),
                "no repository resolved - this session will not appear in the Cursor sessions list"
            );
        }
        let session = Arc::new(Session {
            repo,
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
    pub async fn prompt_content(
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

        let created = match prior_agent {
            Some(agent) => {
                // Queue behind any run still going (the same agent advances
                // from cursor.com too) instead of failing the prompt.
                self.create_run_when_free(&agent, prompt, model.as_ref(), &cancel)
                    .await
                    .map(|run| (agent, run))
            }
            None => {
                // Snapshotted out of the lock: `create_agent` is a network
                // call, and the state mutex must never be held across an await.
                let mcp_servers = session
                    .state
                    .lock()
                    .expect("session state poisoned")
                    .mcp_servers
                    .clone();
                self.cursor
                    .create_agent(prompt, session.repo.as_ref(), &mcp_servers, model.as_ref())
                    .await
                    .map_err(SessionError::from)
            }
        };
        let (agent, run) = match created {
            Ok(created) => created,
            Err(error) => {
                if matches!(&error, SessionError::Cursor(report) if report.downcast_current_context::<crate::domain::error::PromptRejected>().is_some())
                {
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
        session.state.lock().expect("session state poisoned").agent = Some(agent.clone());
        // Acceptance is durable even if recovery of an older run fails. Do
        // not observe/project the new run until every older run is reconciled.
        self.backfill_foreign_runs(session_id, &session, &agent, Some(&run))
            .await?;
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
        if let Err(SessionError::Cursor(error)) = &outcome {
            self.capture(
                session_id,
                &session,
                Some(&run),
                JournalInput::Interrupted(error.to_string()),
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
        match outcome {
            Ok(_) | Err(SessionError::Cursor(_)) if cancelled => Ok(StopReason::Cancelled),
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
            repo,
            restored_model_id: model_id,
            turn_gate: Arc::new(tokio::sync::Mutex::new(())),
            state: Mutex::new(SessionState {
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
        let captured: Vec<_> = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .iter()
            .filter(|e| e.run.as_ref() == Some(run))
            .filter_map(|e| match &e.input {
                JournalInput::Sse(r) if r.is_content() => Some(r.clone()),
                _ => None,
            })
            .collect();
        let mut matched = 0;
        let mut terminal = None;
        let mut saw_content = false;
        let stream = match self.cursor.raw_stream(agent, run).await {
            Ok(stream) => Some(stream),
            Err(error) => {
                self.capture(
                    session_id,
                    session,
                    Some(run),
                    JournalInput::TransportError(error.to_string()),
                    emit,
                )
                .await?;
                None
            }
        };
        if let Some(stream) = stream {
            pin_mut!(stream);
            loop {
                let record = match tokio::time::timeout(STREAM_QUIET_TIMEOUT, stream.next()).await {
                    Ok(Some(Ok(record))) => record,
                    Ok(Some(Err(error))) => {
                        self.capture(
                            session_id,
                            session,
                            Some(run),
                            JournalInput::TransportError(error.to_string()),
                            emit,
                        )
                        .await?;
                        break;
                    }
                    Ok(None) => break,
                    Err(_) if strict => break,
                    Err(_) => {
                        // Quiet streams are checked through the exact same raw
                        // polling/capture path as disconnected streams.
                        let status = self
                            .poll_once(session_id, session, agent, run, cancel, emit)
                            .await?;
                        if status.is_terminal() {
                            terminal = Some(status.status);
                            break;
                        }
                        if cancel.is_cancelled() {
                            break;
                        }
                        continue;
                    }
                };
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
                match record.decode() {
                    CursorEvent::Error { code, .. }
                        if code.as_deref() == Some("stream_unavailable")
                            && !saw_content
                            && attempt < 4 =>
                    {
                        if !sleep_unless_cancelled(cancel, std::time::Duration::from_millis(400))
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
                        break;
                    }
                    CursorEvent::Result { status, .. } => terminal = Some(status),
                    CursorEvent::Error { .. } => break,
                    CursorEvent::Done => break,
                    _ => {}
                }
            }
        }
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
        let status = terminal
            .ok_or_else(|| rootcause::report!("Cursor run {run} did not reach a terminal state"))?;
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
        agent: &CursorAgentId,
        prompt: &str,
        model: Option<&ModelChoice>,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<CursorRunId, SessionError> {
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
                if let Err(error) = history_projection(&state.journal_entries) {
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
            project_entry(&mut machine, entry, &entries)?;
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
        let (updates, completion) = {
            let mut state = session.state.lock().expect("session state poisoned");
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
            (updates, completion)
        };
        if emit {
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

    /// Reconstruct the entire session before allowing a successful load reply.
    /// The returned guard serializes the reply itself with every live writer.
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
        let entries = session
            .state
            .lock()
            .expect("session state poisoned")
            .journal_entries
            .clone();
        let (machine, updates) = history_projection(&entries)?;
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

fn history_projection(
    entries: &[JournalEntry],
) -> Result<(ReplayMachine, HistoryUpdates), SessionError> {
    for entry in entries {
        if entry.run.is_none()
            && matches!(entry.input, JournalInput::Prompt(_))
            && !entries.iter().any(|e| {
                matches!(e.input, JournalInput::PromptAccepted(n) | JournalInput::PromptAborted(n) if n == entry.sequence)
            })
        {
            return Err(rootcause::report!("Cursor prompt acceptance is unknown; refusing incomplete replacement history").into());
        }
    }
    let mut machine = ReplayMachine::default();
    // Validate the whole candidate before publishing even its first frame.
    // Intent position is audit order, not conversation order. Accepted
    // prompts project immediately before their first native run input.
    let mut updates = Vec::new();
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
            return Err(rootcause::report!(
                "Cursor original prompt unavailable for {run}; preserving existing history"
            )
            .into());
        }
    }
    Ok((machine, updates))
}
