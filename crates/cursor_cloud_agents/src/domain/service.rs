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

#[cfg(test)]
mod test;

use crate::domain::error::SessionError;
use crate::domain::event::CursorEvent;
use crate::domain::model::{
    AcpSessionId, CursorAgentId, CursorRunId, McpServer, RepoUrl, RunStatus,
};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use crate::domain::translate::TranslateMachine;
use agent_client_protocol::schema::v1::StopReason;
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

/// How long a prompt waits behind a run something else started (the same
/// agent is drivable from cursor.com) before giving up, in poll intervals.
const BUSY_ATTEMPTS: usize = 450;

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
    cancelled: bool,
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
    /// MCP servers the client named at `session/new`. Applied when the first
    /// prompt creates the agent, since Cursor fixes MCP configuration then.
    mcp_servers: Vec<McpServer>,
    state: Mutex<SessionState>,
}

/// The service behind the ACP handlers.
#[derive(Debug)]
pub struct CursorSessionService<Cursor, Notifier, Repos> {
    cursor: Cursor,
    notifier: Notifier,
    repos: Repos,
    sessions: Mutex<HashMap<AcpSessionId, Arc<Session>>>,
    /// Monotonic counter for minting session ids without a clock or RNG.
    next_session: Mutex<u64>,
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
        }
    }

    /// Open a session for a client working at `cwd`.
    ///
    /// The repository is resolved now rather than at first prompt so the
    /// warning about an unlisted (repo-less) session surfaces at `session/new`
    /// time, when the user can still do something about it.
    pub fn new_session(&self, cwd: &Path, mcp_servers: Vec<McpServer>) -> AcpSessionId {
        let repo = self.repos.resolve(cwd);
        if repo.is_none() {
            tracing::warn!(
                cwd = %cwd.display(),
                "no repository resolved - this session will not appear in the Cursor sessions list"
            );
        }
        let session = Arc::new(Session {
            repo,
            mcp_servers,
            state: Mutex::new(SessionState::default()),
        });
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        // Counter-minted ids restart at 1 each process, but restored sessions
        // carry ids minted by earlier processes — skip over those rather than
        // silently replacing a live session with a fresh one.
        let id = loop {
            let candidate = {
                let mut next = self.next_session.lock().expect("session counter poisoned");
                *next += 1;
                AcpSessionId::new(format!("cursor-acp-{next}"))
            };
            if !sessions.contains_key(&candidate) {
                break candidate;
            }
        };
        sessions.insert(id.clone(), session);
        id
    }

    /// Run one prompt to completion, delivering updates as they stream.
    ///
    /// Resolves with the turn's ACP stop reason once the run's stream ends.
    #[tracing::instrument(skip(self, prompt), err)]
    pub async fn prompt(
        &self,
        session_id: &AcpSessionId,
        prompt: &str,
    ) -> Result<StopReason, SessionError> {
        let session = self.session(session_id)?;

        // Claim the turn before any network call so a racing second prompt
        // fails fast instead of creating a second agent.
        let existing_agent = {
            let mut state = session.state.lock().expect("session state poisoned");
            if state.active_run.is_some() {
                return Err(SessionError::TurnAlreadyActive(session_id.clone()));
            }
            state.cancelled = false;
            state.agent.clone()
        };

        let (agent, run) = match existing_agent {
            Some(agent) => {
                // The same agent advances from cursor.com too. Catch the
                // session's view up on whatever it missed, then queue behind
                // any run still going instead of failing the prompt.
                if let Err(error) = self
                    .backfill_foreign_runs(session_id, &session, &agent)
                    .await
                {
                    tracing::warn!(%agent, %error, "could not backfill cursor.com runs");
                }
                let run = self.create_run_when_free(&session, &agent, prompt).await?;
                (agent, run)
            }
            None => {
                self.cursor
                    .create_agent(prompt, session.repo.as_ref(), &session.mcp_servers)
                    .await?
            }
        };
        tracing::info!(%agent, %run, "cursor run started");
        {
            let mut state = session.state.lock().expect("session state poisoned");
            state.agent = Some(agent.clone());
            state.active_run = Some(run.clone());
        }

        let outcome = self.stream_turn(session_id, &session, &agent, &run).await;

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
    #[tracing::instrument(skip(self), err)]
    pub async fn cancel(&self, session_id: &AcpSessionId) -> Result<(), SessionError> {
        let session = self.session(session_id)?;
        let target = {
            let mut state = session.state.lock().expect("session state poisoned");
            state.cancelled = true;
            state.agent.clone().zip(state.active_run.clone())
        };
        if let Some((agent, run)) = target {
            self.cursor.cancel_run(&agent, &run).await?;
        }
        Ok(())
    }

    /// Drop a session, reporting whether it existed. Any active run keeps
    /// running server-side; closing the ACP session does not imply
    /// cancelling the work.
    ///
    /// The bool is what lets `session/close` answer a client that named a
    /// session this agent never had, rather than acknowledging a no-op.
    pub fn close(&self, session_id: &AcpSessionId) -> bool {
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
        id: AcpSessionId,
        agent: Option<CursorAgentId>,
        repo: Option<RepoUrl>,
        mcp_servers: Vec<McpServer>,
    ) {
        let session = Arc::new(Session {
            repo,
            mcp_servers,
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
    pub fn has_session(&self, session_id: &AcpSessionId) -> bool {
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
        session_id: &AcpSessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<StopReason, SessionError> {
        let stream = match self.cursor.stream(agent, run).await {
            Ok(stream) => stream,
            Err(error) => {
                tracing::warn!(%agent, %run, %error, "run stream would not open; polling instead");
                return self.poll_turn(session_id, session, agent, run, false).await;
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
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    tracing::warn!(%agent, %run, %error, "run stream broke mid-turn; polling instead");
                    return self
                        .poll_turn(session_id, session, agent, run, streamed_text)
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
                        .poll_turn(session_id, session, agent, run, streamed_text)
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
                .poll_turn(session_id, session, agent, run, streamed_text)
                .await;
        }

        match outcome {
            Some(RunStatus::Finished) => Ok(StopReason::EndTurn),
            Some(RunStatus::Cancelled) => Ok(StopReason::Cancelled),
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
    ) -> Result<CursorRunId, SessionError> {
        for _ in 0..BUSY_ATTEMPTS {
            if session
                .state
                .lock()
                .expect("session state poisoned")
                .cancelled
            {
                return Err(SessionError::Cursor(rootcause::report!(
                    "the prompt was cancelled while waiting for the agent to be free"
                )));
            }
            match self.cursor.create_run(agent, prompt).await {
                Ok(run) => return Ok(run),
                Err(error) if error.to_string().contains("agent_busy") => {
                    tracing::info!(%agent, "agent busy (a run is active, possibly from cursor.com); waiting");
                    tokio::time::sleep(POLL_INTERVAL).await;
                }
                Err(error) => return Err(SessionError::Cursor(error)),
            }
        }
        Err(SessionError::Cursor(rootcause::report!(
            "the agent stayed busy for {} seconds",
            BUSY_ATTEMPTS as u64 * POLL_INTERVAL.as_secs()
        )))
    }

    /// Deliver the results of runs something else drove since this session's
    /// last own turn — the cursor.com half of the conversation.
    ///
    /// Only the agent's final text per run is recoverable (the run record
    /// carries no prompt and no tool detail), and only back to the session's
    /// own watermark: with no watermark nothing is backfilled, because a
    /// restored session cannot tell missed runs from already-rendered
    /// history. Best-effort by design — the caller logs and proceeds, since
    /// a failed backfill must not block the prompt that triggered it.
    async fn backfill_foreign_runs(
        &self,
        session_id: &AcpSessionId,
        session: &Session,
        agent: &CursorAgentId,
    ) -> Result<(), SessionError> {
        let Some(last_run) = session
            .state
            .lock()
            .expect("session state poisoned")
            .last_run
            .clone()
        else {
            return Ok(());
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
            .filter(|listing| !matches!(listing.status, RunStatus::Creating | RunStatus::Running))
            .collect();

        // Oldest first, the order the conversation actually happened.
        for listing in unseen.into_iter().rev() {
            let outcome = self
                .cursor
                .run_result(agent, &listing.id)
                .await
                .map_err(SessionError::Cursor)?;
            let Some(text) = outcome.text else { continue };
            tracing::info!(%agent, run = %listing.id, "backfilling a cursor.com run");
            let events = [
                CursorEvent::Assistant {
                    text: format!("*(answered on cursor.com)*\n\n{text}"),
                },
                CursorEvent::Result {
                    run_id: listing.id.clone(),
                    status: outcome.status,
                    text: None,
                    duration_ms: None,
                },
            ];
            for event in events {
                let updates = {
                    let mut state = session.state.lock().expect("session state poisoned");
                    state.translator.push(event)
                };
                for update in updates {
                    self.notifier.notify(session_id, update).await?;
                }
            }
            session
                .state
                .lock()
                .expect("session state poisoned")
                .last_run = Some(listing.id);
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
        session_id: &AcpSessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
        streamed_text: bool,
    ) -> Result<StopReason, SessionError> {
        let mut consecutive_errors = 0;
        for _ in 0..POLL_ATTEMPTS {
            // A client cancel ends the wait, not just the run: the server
            // often closes a cancelled run's stream without a result, and
            // polling an outcome nobody wants any more would hold the turn
            // open for minutes.
            if session
                .state
                .lock()
                .expect("session state poisoned")
                .cancelled
            {
                return Ok(StopReason::Cancelled);
            }
            let outcome = match self.cursor.run_result(agent, run).await {
                Ok(outcome) => outcome,
                // A blip mid-poll is survivable; the same failure over and
                // over is the API saying no.
                Err(error) if consecutive_errors < POLL_ERROR_TOLERANCE => {
                    consecutive_errors += 1;
                    tracing::warn!(%agent, %run, %error, consecutive_errors, "run poll failed");
                    tokio::time::sleep(POLL_INTERVAL).await;
                    continue;
                }
                Err(error) => return Err(SessionError::Cursor(error)),
            };
            consecutive_errors = 0;
            if !outcome.is_terminal() {
                tokio::time::sleep(POLL_INTERVAL).await;
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
                RunStatus::Cancelled => Ok(StopReason::Cancelled),
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

    fn session(&self, id: &AcpSessionId) -> Result<Arc<Session>, SessionError> {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| SessionError::UnknownSession(id.clone()))
    }
}
