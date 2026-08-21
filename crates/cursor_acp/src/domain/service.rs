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

/// One session's mutable state. Guarded by a std mutex: every critical
/// section is a handful of field reads/writes, never an await.
#[derive(Debug, Default)]
struct SessionState {
    /// The Cursor agent, once the first prompt has minted it.
    agent: Option<CursorAgentId>,
    /// The run currently streaming, so cancel knows what to cancel.
    active_run: Option<CursorRunId>,
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
        let id = {
            let mut next = self.next_session.lock().expect("session counter poisoned");
            *next += 1;
            AcpSessionId::new(format!("cursor-acp-{next}"))
        };
        let session = Arc::new(Session {
            repo,
            mcp_servers,
            state: Mutex::new(SessionState::default()),
        });
        self.sessions
            .lock()
            .expect("session map poisoned")
            .insert(id.clone(), session);
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
                let run = self.cursor.create_run(&agent, prompt).await?;
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

    /// Stream one run, translating and delivering as events arrive.
    async fn stream_turn(
        &self,
        session_id: &AcpSessionId,
        session: &Session,
        agent: &CursorAgentId,
        run: &CursorRunId,
    ) -> Result<StopReason, SessionError> {
        let stream = self.cursor.stream(agent, run).await?;
        pin_mut!(stream);

        // The run's own verdict, set only by a `result` event. Every recorded
        // run ends with one (`fixtures/real/*.sse`), including the cancelled
        // one — which is why the terminal signal is the result rather than
        // the envelope's `turn-ended`, that being absent when a turn is cut
        // short.
        let mut outcome = None;
        while let Some(event) = stream.next().await {
            let event = event?;
            match &event {
                CursorEvent::Result { status, .. } => outcome = Some(status.clone()),
                CursorEvent::Error { code, message } => {
                    return Err(SessionError::Cursor(rootcause::report!(
                        "cursor stream error {code:?}: {message}"
                    )));
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

    fn session(&self, id: &AcpSessionId) -> Result<Arc<Session>, SessionError> {
        self.sessions
            .lock()
            .expect("session map poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| SessionError::UnknownSession(id.clone()))
    }
}
