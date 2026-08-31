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
use crate::domain::event::{CursorEvent, InteractionUpdate};
use crate::domain::model::{
    CursorAgentId, CursorModel, CursorRunId, McpServer, ModelChoice, RepoUrl, RunStatus,
};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use crate::domain::translate::TranslateMachine;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, SessionId, SessionUpdate, StopReason, TextContent,
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
    translator: TranslateMachine,
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
    turn_gate: tokio::sync::Mutex<()>,
    state: Mutex<SessionState>,
}

/// The service behind the ACP handlers.
#[derive(Debug)]
pub struct CursorSessionService<Cursor, Notifier, Repos> {
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
    pub fn new(cursor: Cursor, notifier: Notifier, repos: Repos) -> Self {
        Self {
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
            turn_gate: tokio::sync::Mutex::new(()),
            state: Mutex::new(SessionState {
                mcp_servers,
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

    /// Run one prompt to completion, delivering updates as they stream.
    ///
    /// Resolves with the turn's ACP stop reason once the run's stream ends.
    #[tracing::instrument(skip(self, prompt), err)]
    pub async fn prompt(
        &self,
        session_id: &SessionId,
        prompt: &str,
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

        // Claim the turn before any network call so a racing second prompt
        // fails fast instead of creating a second agent.
        // Resolved before the turn commits to a path: both the create-agent
        // and the follow-up-run branch send it, and a mid-turn change must not
        // land on a run that is already going.
        let model = self.effective_model(session_id).await?;

        let (existing_agent, cancel) = {
            let mut state = session.state.lock().expect("session state poisoned");
            if state.active_run.is_some() {
                return Err(SessionError::TurnAlreadyActive(session_id.clone()));
            }
            state.cancelled = false;
            // A fresh token per turn: the previous one may already be fired,
            // and reusing it would cancel this turn before it began.
            state.cancel = tokio_util::sync::CancellationToken::new();
            (state.agent.clone(), state.cancel.clone())
        };

        let (agent, run) = match existing_agent {
            Some(agent) => {
                // Queue behind any run still going (the same agent advances
                // from cursor.com too) instead of failing the prompt.
                let run = match self
                    .create_run_when_free(&agent, prompt, model.as_ref(), &cancel)
                    .await
                {
                    Ok(run) => run,
                    // The wait ended because the client asked to stop, which
                    // ACP answers with a stop reason rather than an error.
                    Err(_) if cancel.is_cancelled() => return Ok(StopReason::Cancelled),
                    Err(error) => return Err(error),
                };
                // Catch the session's view up on whatever it missed while it
                // was not looking. After the create on purpose: creating
                // proved the agent free, so every missed run is terminal and
                // its text is readable — before it, a still-running
                // cursor.com run is invisible to the backfill and the
                // watermark then walks straight past it.
                if let Err(error) = self
                    .backfill_foreign_runs(session_id, &session, &agent, Some(&run))
                    .await
                {
                    tracing::warn!(%agent, %error, "could not backfill cursor.com runs");
                }
                (agent, run)
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
                    .await?
            }
        };
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
            state.last_run = Some(run.clone());
            state.cancelled
        };
        // A cancel that raced the stream's own ending still reports
        // Cancelled: ACP requires it once the client sent `session/cancel`.
        match outcome {
            _ if cancelled => Ok(StopReason::Cancelled),
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
        let listings = match self.cursor.list_runs(agent).await {
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
    /// The service is deliberately storage-free; whatever survives a restart
    /// is the host's business, and this is how the host hands it back. With
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
        // No MCP servers here on purpose: the host never had the truth to
        // hand over — the list belongs to the ACP client, and the client
        // restates it on `session/load`, which is where it re-enters.
        let session = Arc::new(Session {
            repo,
            restored_model_id: model_id,
            turn_gate: tokio::sync::Mutex::new(()),
            state: Mutex::new(SessionState {
                agent,
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
    /// any streaming failure here degrades to [`Self::poll_turn`] rather than
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
        let stream = match self.cursor.stream(agent, run).await {
            Ok(stream) => stream,
            Err(error) => {
                tracing::warn!(%agent, %run, %error, "run stream would not open; polling instead");
                return self
                    .poll_turn(session_id, session, agent, run, false, cancel)
                    .await;
            }
        };
        pin_mut!(stream);

        // The run's own verdict, set only by a `result` event. Every recorded
        // run ends with one (`fixtures/real/*.sse`), including the cancelled
        // one — which is why the terminal signal is the result rather than
        // the envelope's `turn-ended`, that being absent when a turn is cut
        // short.
        let mut outcome = None;
        // Whether any assistant text was delivered live, so a fallback knows
        // not to repeat it from the run's final result.
        let mut streamed_text = false;
        loop {
            // A client cancel is a notification already POSTed; it does not
            // outrank the stream. Cursor's `result` frame is what ends the
            // turn, including a cancelled one.
            let next = match tokio::time::timeout(STREAM_QUIET_TIMEOUT, stream.next()).await {
                Ok(next) => next,
                // The stream has gone quiet. If the run is already over, the
                // stream's terminal event is the only thing anyone is waiting
                // for — take the answer from the record instead of holding
                // the turn open for it.
                Err(_elapsed) => {
                    match self.cursor.run_result(agent, run).await {
                        Ok(outcome) if outcome.is_terminal() => {
                            tracing::info!(
                                %agent, %run, status = ?outcome.status,
                                "run finished but its stream went quiet; closing the turn from the record"
                            );
                            return self
                                .poll_turn(session_id, session, agent, run, streamed_text, cancel)
                                .await;
                        }
                        // Still running: keep listening. Unless the client
                        // stopped, in which case a silent stream and a run
                        // the record says is still going is nothing left to
                        // wait for.
                        Ok(_) if cancel.is_cancelled() => {
                            tracing::info!(%agent, %run, "stopped run's stream went quiet");
                            self.close_open_tool_calls(session_id, session).await;
                            return Ok(StopReason::Cancelled);
                        }
                        Ok(_) => continue,
                        Err(error) => {
                            tracing::warn!(%agent, %run, %error, "quiet-stream status check failed");
                            continue;
                        }
                    }
                }
            };
            let Some(event) = next else { break };
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    tracing::warn!(%agent, %run, %error, "run stream broke mid-turn; polling instead");
                    return self
                        .poll_turn(session_id, session, agent, run, streamed_text, cancel)
                        .await;
                }
            };
            match &event {
                CursorEvent::Result { status, .. } => outcome = Some(status.clone()),
                CursorEvent::Assistant { .. } => streamed_text = true,
                CursorEvent::Error { code, message } => {
                    tracing::warn!(
                        %agent, %run, ?code, %message,
                        "cursor reported a stream error mid-turn; polling instead"
                    );
                    return self
                        .poll_turn(session_id, session, agent, run, streamed_text, cancel)
                        .await;
                }
                _ => {}
            }
            let done = matches!(event, CursorEvent::Done);

            let updates = {
                let mut state = session.state.lock().expect("session state poisoned");
                state.translator.push(event)
            };
            for update in updates {
                self.notifier.notify(session_id, update).await?;
            }
            if done {
                break;
            }
        }

        // A stream that closed without ever saying how the run ended proves
        // nothing about the run; ask the API rather than guessing.
        if outcome.is_none() {
            tracing::warn!(%agent, %run, "run stream ended without a result; polling instead");
            return self
                .poll_turn(session_id, session, agent, run, streamed_text, cancel)
                .await;
        }

        match outcome {
            Some(RunStatus::Finished) => Ok(StopReason::EndTurn),
            Some(RunStatus::Cancelled) => {
                self.close_open_tool_calls(session_id, session).await;
                Ok(StopReason::Cancelled)
            }
            // A run that ended in any other state did not succeed, and ACP
            // answers a prompt with a stop reason or an error — there is no
            // stop reason for "it failed", so this is an error.
            //
            // `RunStatus::Unknown` lands here too, which is deliberate: it
            // absorbs any status Cursor adds, so treating it as a clean
            // finish would silently report success for an outcome nobody has
            // read. The cost is that renaming `FINISHED` upstream fails loud
            // instead of quiet, which is the right way round.
            Some(status) => Err(SessionError::Cursor(rootcause::report!(
                "cursor run {run} ended in {status:?}"
            ))),
            // See [`crate::domain::ports::RunStream`]: a consumer that never
            // sees a terminal result must treat the outcome as unknown rather
            // than successful. A dropped connection ends the stream exactly
            // here, with the run quite possibly still going server-side.
            None => Err(SessionError::Cursor(rootcause::report!(
                "cursor stream for run {run} ended without reporting a result"
            ))),
        }
    }

    /// Wait out one poll interval, unless the client has stopped the turn.
    /// `true` means it has, and the turn is over.
    ///
    /// The only cancel check in the fallback poll. Ending here is not the
    /// local settle this service refuses elsewhere: the poll runs precisely
    /// because the stream is gone, so there are no frames left to abandon —
    /// only a record to stop re-reading on the user's behalf.
    async fn wait_unless_stopped(
        &self,
        session_id: &SessionId,
        session: &Session,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> bool {
        if !sleep_unless_cancelled(cancel, POLL_INTERVAL).await {
            return false;
        }
        tracing::info!("turn stopped while polling for its run's record");
        self.close_open_tool_calls(session_id, session).await;
        true
    }

    /// Close out every tool call still open when a turn ends cancelled.
    ///
    /// Cursor's `result` with `CANCELLED` is the terminal frame; it does not
    /// always include a completed `tool_call` for work that was mid-flight,
    /// so without this the client would render that call running forever.
    async fn close_open_tool_calls(&self, session_id: &SessionId, session: &Session) {
        let updates = session
            .state
            .lock()
            .expect("session state poisoned")
            .translator
            .close_open_calls();
        for update in updates {
            if let Err(error) = self.notifier.notify(session_id, update).await {
                tracing::warn!(%error, "could not close an open tool call after cancel");
            }
        }
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
                return Err(SessionError::Cursor(rootcause::report!(
                    "the prompt was cancelled while waiting for the agent to be free"
                )));
            }
            match self.cursor.create_run(agent, prompt, model).await {
                Ok(run) => return Ok(run),
                Err(error) if error.to_string().contains("agent_busy") => {
                    tracing::info!(%agent, "agent busy (a run is active, possibly from cursor.com); waiting");
                    if sleep_unless_cancelled(cancel, POLL_INTERVAL).await {
                        return Err(SessionError::Cursor(rootcause::report!(
                            "the prompt was cancelled while waiting for the agent to be free"
                        )));
                    }
                }
                Err(error) => return Err(SessionError::Cursor(error)),
            }
        }
        Err(SessionError::Cursor(rootcause::report!(
            "the agent stayed busy for {} seconds",
            BUSY_ATTEMPTS as u64 * POLL_INTERVAL.as_secs()
        )))
    }

    /// Mirror runs something else drove since this session's last own turn —
    /// the cursor.com half of the conversation.
    ///
    /// Each unseen run is replayed through its own stream, so the mirror has
    /// the same fidelity as a live turn: the user's prompt (streams carry
    /// `user-message-appended`; run records do not), thoughts, tool calls,
    /// and the answer. A run still going is simply followed to its end. Only
    /// when the stream is gone (retention expired, connection refused past
    /// retries) does a run degrade to its recorded final text. Bounded by
    /// the session's own watermark: with none, nothing is mirrored, because
    /// a restored session cannot tell missed runs from already-rendered
    /// history. Best-effort by design — callers log and proceed, since a
    /// failed mirror must not block the prompt or the next tick.
    ///
    /// Callers hold the session's turn gate.
    async fn backfill_foreign_runs(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        current_run: Option<&CursorRunId>,
    ) -> Result<bool, SessionError> {
        let Some(last_run) = session
            .state
            .lock()
            .expect("session state poisoned")
            .last_run
            .clone()
        else {
            return Ok(false);
        };

        let listings = self
            .cursor
            .list_runs(agent)
            .await
            .map_err(SessionError::Cursor)?;
        // Newest first; keep what is newer than the watermark. A watermark
        // past the page's horizon means over a page of foreign runs — deliver
        // the page rather than nothing.
        let unseen: Vec<_> = listings
            .into_iter()
            .take_while(|listing| listing.id != last_run)
            // The run this prompt just created is newer than everything
            // foreign; its own turn delivers it.
            .filter(|listing| current_run != Some(&listing.id))
            .collect();
        let mirrored = !unseen.is_empty();

        // Oldest first, the order the conversation actually happened.
        for listing in unseen.into_iter().rev() {
            tracing::info!(%agent, run = %listing.id, "mirroring a cursor.com run");
            self.mirror_foreign_run(session_id, session, agent, &listing.id)
                .await?;
            session
                .state
                .lock()
                .expect("session state poisoned")
                .last_run = Some(listing.id);
        }
        Ok(mirrored)
    }

    /// Replay one cursor.com run into the session, falling back to its
    /// recorded final text when the stream cannot be had.
    async fn mirror_foreign_run(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<(), SessionError> {
        let replayed = match self.cursor.stream(agent, run).await {
            Ok(stream) => {
                pin_mut!(stream);
                let mut saw_result = false;
                loop {
                    let event = match stream.next().await {
                        Some(Ok(event)) => event,
                        Some(Err(error)) => {
                            tracing::warn!(%agent, %run, %error, "foreign run stream broke; falling back to its record");
                            break false;
                        }
                        None => break saw_result,
                    };
                    match event {
                        // The prompt typed on cursor.com. The translator
                        // drops these (a live turn's prompt is already on
                        // screen), but in a mirror it is the missing half of
                        // the conversation — delivered quoted, since the log
                        // renders everything here as the agent's.
                        CursorEvent::Interaction(InteractionUpdate::UserMessage { text }) => {
                            let quoted = text.replace('\n', "\n> ");
                            self.notifier
                                .notify(
                                    session_id,
                                    SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                        ContentBlock::Text(TextContent::new(format!(
                                            "*(asked on cursor.com)*\n\n> {quoted}\n\n"
                                        ))),
                                    )),
                                )
                                .await?;
                        }
                        CursorEvent::Error { code, message } => {
                            tracing::warn!(%agent, %run, ?code, %message, "foreign run stream errored; falling back to its record");
                            break false;
                        }
                        event => {
                            if matches!(event, CursorEvent::Result { .. }) {
                                saw_result = true;
                            }
                            let done = matches!(event, CursorEvent::Done);
                            let updates = {
                                let mut state =
                                    session.state.lock().expect("session state poisoned");
                                state.translator.push(event)
                            };
                            for update in updates {
                                self.notifier.notify(session_id, update).await?;
                            }
                            if done {
                                break saw_result;
                            }
                        }
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%agent, %run, %error, "foreign run stream unavailable; falling back to its record");
                false
            }
        };
        if replayed {
            return Ok(());
        }

        // The stream is gone (retention expired, or refused past the connect
        // retries). The run record still has the final answer.
        let outcome = self
            .cursor
            .run_result(agent, run)
            .await
            .map_err(SessionError::Cursor)?;
        let mut events = Vec::new();
        if let Some(text) = outcome.text.clone() {
            events.push(CursorEvent::Assistant {
                text: format!("*(answered on cursor.com)*\n\n{text}"),
            });
        }
        events.push(CursorEvent::Result {
            run_id: run.clone(),
            status: outcome.status,
            text: None,
            duration_ms: None,
        });
        for event in events {
            let updates = {
                let mut state = session.state.lock().expect("session state poisoned");
                state.translator.push(event)
            };
            for update in updates {
                self.notifier.notify(session_id, update).await?;
            }
        }
        Ok(())
    }

    /// Finish a turn without a stream: poll the run until it is terminal,
    /// then deliver what streaming would have.
    ///
    /// `streamed_text` says whether any assistant text already reached the
    /// client live, so a turn whose stream died halfway does not repeat the
    /// whole answer from the run's final result. Liveness is what this path
    /// gives up; tool-call detail too — the run record carries only the final
    /// text — but the turn ends with its answer delivered and its real
    /// outcome, which is the part that must not be lost.
    async fn poll_turn(
        &self,
        session_id: &SessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        streamed_text: bool,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<StopReason, SessionError> {
        let mut consecutive_errors = 0;
        for _ in 0..POLL_ATTEMPTS {
            // Both waits below go through `wait_unless_stopped`, the one
            // place a stop ends this poll.
            let outcome = match self.cursor.run_result(agent, run).await {
                Ok(outcome) => outcome,
                // A blip mid-poll is survivable; the same failure over and
                // over is the API saying no.
                Err(error) if consecutive_errors < POLL_ERROR_TOLERANCE => {
                    consecutive_errors += 1;
                    tracing::warn!(%agent, %run, %error, consecutive_errors, "run poll failed");
                    if self.wait_unless_stopped(session_id, session, cancel).await {
                        return Ok(StopReason::Cancelled);
                    }
                    continue;
                }
                Err(error) => return Err(SessionError::Cursor(error)),
            };
            consecutive_errors = 0;
            if !outcome.is_terminal() {
                if self.wait_unless_stopped(session_id, session, cancel).await {
                    return Ok(StopReason::Cancelled);
                }
                continue;
            }

            tracing::info!(%agent, %run, status = ?outcome.status, "run finished; delivering its polled result");
            let mut events = Vec::new();
            if let (false, Some(text)) = (streamed_text, outcome.text.clone()) {
                events.push(CursorEvent::Assistant { text });
            }
            events.push(CursorEvent::Result {
                run_id: run.clone(),
                status: outcome.status.clone(),
                text: outcome.text,
                duration_ms: None,
            });
            for event in events {
                let updates = {
                    let mut state = session.state.lock().expect("session state poisoned");
                    state.translator.push(event)
                };
                for update in updates {
                    self.notifier.notify(session_id, update).await?;
                }
            }
            return match outcome.status {
                RunStatus::Finished => Ok(StopReason::EndTurn),
                RunStatus::Cancelled => {
                    self.close_open_tool_calls(session_id, session).await;
                    Ok(StopReason::Cancelled)
                }
                status => Err(SessionError::Cursor(rootcause::report!(
                    "cursor run {run} ended in {status:?}"
                ))),
            };
        }
        Err(SessionError::Cursor(rootcause::report!(
            "cursor run {run} still not terminal after polling for {} seconds",
            POLL_ATTEMPTS as u64 * POLL_INTERVAL.as_secs()
        )))
    }

    /// Mirror cursor.com activity into every live session, once.
    ///
    /// The host calls this on a timer while a session's transport is up, so
    /// the cursor.com half of a conversation appears here within a tick of
    /// happening rather than waiting for the next Macro prompt. A session
    /// mid-turn is skipped (the turn gate is held), as is one that never
    /// drove a run (no watermark to mirror from). Failures are logged per
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
            let Some(agent) = session
                .state
                .lock()
                .expect("session state poisoned")
                .agent
                .clone()
            else {
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

    fn session(&self, id: &SessionId) -> Result<Arc<Session>, SessionError> {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| SessionError::UnknownSession(id.clone()))
    }
}
