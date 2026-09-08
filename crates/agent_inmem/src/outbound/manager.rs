//! Provisioning for in-process agent "containers".
//!
//! The sandbox flavor of this is a Daytona API call and a WebSocket; here it
//! is a duplex channel and a Tokio task, which is what makes a session start
//! in milliseconds. The manager owns the map from session to live agent task
//! and the conversation store those tasks read.

use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::{RuntimeConnection, ServerChannel};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use agent_session::domain::model::AgentSessionId;
use dashmap::DashMap;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::agent::{AgentState, serve};
use crate::domain::engine::TurnEngine;
use crate::domain::mcp::DynMcpToolConnector;
use crate::domain::replay::{FrameSource, replay_history};
use crate::domain::session::{SessionState, SessionStore};

#[cfg(test)]
mod test;

/// The session-row facts an agent task runs from.
#[derive(Debug, Clone)]
pub struct SessionFacts {
    /// The session the agent serves.
    pub id: AgentSessionId,
    /// The session's owner; turns act on their behalf.
    pub owner: MacroUserIdStr<'static>,
    /// Model id stamped on the session row.
    pub model: String,
    /// Instructions stamped on the session row, folded into every turn's
    /// system prompt. Immutable for the session's life, so a reattach that
    /// finds a live conversation leaves what is stored alone.
    pub instructions: Option<String>,
    /// The ACP session id the row carries, when one was ever negotiated. A
    /// cold attach hydrates its rebuilt conversation under this id so the
    /// harness's `session/resume` keeps it.
    pub acp_session_id: Option<SessionId>,
}

/// One live agent task and its runtime connection.
///
/// Dropping this ends the agent: the connection's driver aborts with it, and
/// the serve task is aborted explicitly.
struct LiveAgent {
    /// Held for its `Drop`: it aborts the connection driver.
    _runtime: RuntimeConnection,
    task: tokio::task::AbortHandle,
}

impl Drop for LiveAgent {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Provisions and tears down in-process agents, one per session.
pub struct InMemAgentManager {
    engine: Arc<dyn TurnEngine>,
    frames: Arc<dyn FrameSource>,
    mcp: Arc<dyn DynMcpToolConnector>,
    store: Arc<SessionStore>,
    live: DashMap<AgentSessionId, LiveAgent>,
    /// Each live session's egress token. An in-process session has no
    /// container environment to read it back from, so the manager is the
    /// one place it survives spawn; a resume after a restart finds nothing
    /// here and advertises no servers, exactly like a sandbox whose
    /// container is gone.
    tokens: DashMap<AgentSessionId, String>,
}

impl InMemAgentManager {
    /// A manager running every session's turns through `engine`, rebuilding
    /// cold sessions' conversations from `frames`, and dialing the MCP
    /// servers each session is handed through `mcp`.
    #[must_use]
    pub fn new(
        engine: Arc<dyn TurnEngine>,
        frames: Arc<dyn FrameSource>,
        mcp: Arc<dyn DynMcpToolConnector>,
    ) -> Self {
        Self {
            engine,
            frames,
            mcp,
            store: Arc::new(SessionStore::new()),
            live: DashMap::new(),
            tokens: DashMap::new(),
        }
    }

    /// The egress token `attach` was handed for `session`, if this process
    /// still holds it.
    #[must_use]
    pub fn session_token(&self, session: AgentSessionId) -> Option<String> {
        self.tokens.get(&session).map(|token| token.clone())
    }

    /// Start (or restart) the session's agent and return the transport the
    /// harness attaches. Spawn and resume are the same operation here: the
    /// conversation store is what persists across reattachment, not the
    /// task - and a session this process has never held (a fresh spawn, or a
    /// resume after a restart) gets its conversation rebuilt from the durable
    /// frame log first.
    ///
    /// `session_token` is the egress token minted at spawn; a resume passes
    /// `None` and keeps whatever spawn stored.
    #[must_use]
    pub async fn attach(
        &self,
        facts: SessionFacts,
        session_token: Option<String>,
    ) -> ServerChannel {
        // A replaced agent must die before its successor serves the session.
        self.live.remove(&facts.id);
        if let Some(token) = session_token {
            self.tokens.insert(facts.id, token);
        }
        if !self.store.contains_key(&facts.id) {
            // Loaded before taking the entry so the read never blocks the
            // map; `or_insert_with` still wins any race to create it.
            let history = replay_history(self.frames.frames(facts.id).await);
            self.store.entry(facts.id).or_insert_with(|| SessionState {
                acp_session_id: facts.acp_session_id.clone(),
                model: facts.model.clone(),
                instructions: facts.instructions.clone(),
                history,
            });
        }

        let (server_half, runtime_half) = Channel::duplex();
        let (runtime, acp) = RuntimeConnection::connect(runtime_half);
        let state = Arc::new(AgentState {
            session_id: facts.id,
            owner: facts.owner,
            engine: Arc::clone(&self.engine),
            store: Arc::clone(&self.store),
            active_cancel: std::sync::Mutex::new(Vec::new()),
            turn_lock: tokio::sync::Mutex::new(()),
            mcp: Arc::clone(&self.mcp),
            mcp_tools: std::sync::Mutex::new(None),
        });
        let session_id = facts.id;
        let task = tokio::spawn(async move {
            if let Err(error) = serve(state, acp).await {
                tracing::warn!(error = ?error, %session_id, "in-process agent stopped on an error");
            }
        });

        // Queued before the harness can possibly read, so the handshake
        // trigger is always the first thing it sees - same contract as the
        // sidecar transport.
        let _ = runtime.system_event(SystemEvent::AcpReady);
        self.live.insert(
            facts.id,
            LiveAgent {
                _runtime: runtime,
                task: task.abort_handle(),
            },
        );
        server_half
    }

    /// End the session for good: kill its agent task and drop its
    /// conversation.
    pub fn teardown(&self, session: AgentSessionId) {
        self.live.remove(&session);
        self.store.remove(&session);
        self.tokens.remove(&session);
    }
}
