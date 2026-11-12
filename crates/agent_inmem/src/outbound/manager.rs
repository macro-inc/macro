//! Provisioning for in-process agent "containers".
//!
//! The sandbox flavor of this is a Daytona API call and a WebSocket; here it
//! is a duplex channel and a Tokio task, which is what makes a session start
//! in milliseconds. The manager owns the map from session to live agent task
//! and the conversation store those tasks read.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use agent_api_keys::domain::{AgentKeys, NoAgentKeys};
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::{RuntimeConnection, ServerChannel};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use agent_session::domain::model::AgentSessionId;
use ai_billing::domain::{AiAdmissionService, DisabledAiAdmissionService};
use dashmap::DashMap;
use model_owner::Owner;

use crate::domain::agent::{AgentState, serve};
use crate::domain::engine::{AgentIdentity, ReplyDelivery, TurnEngine};
use crate::domain::mcp::DynMcpToolConnector;
use crate::domain::replay::{FrameSource, replay_history, replay_reasoning_effort, replay_speed};
use crate::domain::session::{HistoryEntry, SessionState, SessionStore, Summarizing};

#[cfg(test)]
mod test;

/// The session-row facts an agent task runs from.
#[derive(Debug, Clone)]
pub struct SessionFacts {
    /// The session the agent serves.
    pub id: AgentSessionId,
    /// The session's owner; turns act on their behalf.
    pub owner: Owner,
    /// Whether the session's turns are billed to its owner, stamped on the
    /// session row by whoever opened it.
    pub billing: agent_session::domain::model::SessionBilling,
    /// How the session's replies reach their reader.
    pub delivery: ReplyDelivery,
    /// Model id stamped on the session row.
    pub model: String,
    /// The bot's display name and `@` handle, folded into every turn's
    /// system prompt so the model knows who it is. Looked up from the
    /// session's bot at attach; `None` only in tests that do not name one.
    pub identity: Option<AgentIdentity>,
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
    admission: Arc<dyn AiAdmissionService>,
    agent_keys: Arc<dyn AgentKeys>,
    model_access: Arc<dyn crate::domain::model_access::InMemModelAccess>,
    frames: Arc<dyn FrameSource>,
    mcp: Arc<dyn DynMcpToolConnector>,
    enable_dev_commands: bool,
    store: Arc<SessionStore>,
    live: DashMap<AgentSessionId, LiveAgent>,
    /// Each live session's egress token. An in-process session has no
    /// container environment to read it back from, so the manager is the
    /// one place it survives spawn or resume.
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
        model_access: Arc<dyn crate::domain::model_access::InMemModelAccess>,
    ) -> Self {
        Self {
            engine,
            model_access,
            admission: Arc::new(DisabledAiAdmissionService),
            agent_keys: Arc::new(NoAgentKeys),
            frames,
            mcp,
            enable_dev_commands: false,
            store: Arc::new(SessionStore::new()),
            live: DashMap::new(),
            tokens: DashMap::new(),
        }
    }

    /// Inject the host's configured admission capability for every new turn.
    /// Production hosts must set this; the constructor defaults to disabled.
    #[must_use]
    pub fn with_admission(mut self, admission: Arc<dyn AiAdmissionService>) -> Self {
        self.admission = admission;
        self
    }

    /// Let agents' turns run on their own API keys. Without this, every turn
    /// runs on Macro's allowance.
    #[must_use]
    pub fn with_agent_keys(mut self, agent_keys: Arc<dyn AgentKeys>) -> Self {
        self.agent_keys = agent_keys;
        self
    }

    /// How many sessions' conversations this process holds.
    #[must_use]
    pub fn conversations(&self) -> usize {
        self.store.len()
    }

    /// Whether this process holds `session`'s conversation.
    #[must_use]
    pub fn holds(&self, session: AgentSessionId) -> bool {
        self.store.contains_key(&session)
    }

    /// How many sessions have a running agent task in this process.
    #[must_use]
    pub fn live_agents(&self) -> usize {
        self.live.len()
    }

    /// The egress token `attach` was handed for `session`, if this process
    /// still holds it.
    #[must_use]
    pub fn session_token(&self, session: AgentSessionId) -> Option<String> {
        self.tokens.get(&session).map(|token| token.clone())
    }

    /// Enable manual development commands such as `/ask`. Disabled by default;
    /// the host opts in for its local and development environments.
    #[must_use]
    pub fn with_dev_commands(mut self, enabled: bool) -> Self {
        self.enable_dev_commands = enabled;
        self
    }

    /// Start (or restart) the session's agent and return the transport the
    /// harness attaches. Spawn and resume are the same operation here: the
    /// conversation store is what persists across reattachment, not the
    /// task - and a session this process has never held (a fresh spawn, or a
    /// resume after a restart) gets its conversation rebuilt from the durable
    /// frame log first.
    ///
    /// `session_token` is the egress token minted for this attach; `None`
    /// keeps the stored one. A token it replaces is no longer accepted, so
    /// the MCP sessions opened with it are released.
    pub async fn attach(
        &self,
        facts: SessionFacts,
        session_token: Option<String>,
    ) -> agent_session::domain::error::Result<ServerChannel> {
        if !self.store.contains_key(&facts.id) {
            // Loaded before taking the entry so the read never blocks the
            // map; `or_insert_with` still wins any race to create it.
            let frames = self.frames.frames(facts.id).await?;
            let rebuilt = rebuilt_state(&facts, frames);
            self.store.entry(facts.id).or_insert(rebuilt);
        }

        // Do not replace a runtime or cache a credential until its history is
        // available. A failed cold restore can safely be retried.
        self.live.remove(&facts.id);
        if let Some(token) = session_token
            && let Some(replaced) = self.tokens.insert(facts.id, token.clone())
            && replaced != token
        {
            self.mcp.release_dyn(&replaced);
        }

        let (server_half, runtime_half) = Channel::duplex();
        let (runtime, acp) = RuntimeConnection::connect(runtime_half);
        let state = Arc::new(AgentState {
            session_id: facts.id,
            owner: facts.owner,
            feature: crate::domain::admission::session_feature(facts.billing),
            delivery: facts.delivery,
            engine: Arc::clone(&self.engine),
            admission: Arc::clone(&self.admission),
            agent_keys: Arc::clone(&self.agent_keys),
            model_access: Arc::clone(&self.model_access),
            store: Arc::clone(&self.store),
            active_cancel: std::sync::Mutex::new(Vec::new()),
            turn_lock: tokio::sync::Mutex::new(()),
            mcp: Arc::clone(&self.mcp),
            mcp_tools: std::sync::Mutex::new(None),
            mcp_connect: std::sync::Mutex::new(None),
            client_renders_forms: AtomicBool::new(false),
            enable_dev_commands: self.enable_dev_commands,
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
        Ok(server_half)
    }

    /// Whether a cold [`Self::attach`] from the log would give `facts`'s
    /// agent exactly the state it runs on now, so that dropping it with
    /// [`Self::teardown`] changes nothing the model sees. A session this
    /// process holds nothing for answers yes.
    ///
    /// Compared as the model reads it: reasoning parts are dropped before a
    /// turn's messages are built, so they are left out on both sides. Summary
    /// state is not in the log at all, so a summary in flight, one that
    /// failed, or images already described keep the session here.
    pub async fn rebuilds_identically(
        &self,
        facts: &SessionFacts,
    ) -> agent_session::domain::error::Result<bool> {
        match self.store.get(&facts.id) {
            None => return Ok(true),
            Some(live) => {
                let summarizing = &live.summarizing;
                if summarizing.pending.is_some()
                    || summarizing.failed_at.is_some()
                    || !summarizing.descriptions.is_empty()
                {
                    return Ok(false);
                }
            }
        }

        let rebuilt = rebuilt_state(facts, self.frames.frames(facts.id).await?);
        let Some(live) = self.store.get(&facts.id) else {
            return Ok(true);
        };
        Ok(live.acp_session_id == rebuilt.acp_session_id
            && live.model == rebuilt.model
            && live.reasoning_effort == rebuilt.reasoning_effort
            && live.speed == rebuilt.speed
            && live.identity == rebuilt.identity
            && live.instructions == rebuilt.instructions
            && model_history(&live.history) == model_history(&rebuilt.history))
    }

    /// Drop everything this process holds for the session: kill its agent
    /// task, drop its conversation, and close the MCP sessions its token was
    /// holding open. Used on delete, and by the harness's idle release; a
    /// later [`Self::attach`] rebuilds the conversation from the log.
    pub fn teardown(&self, session: AgentSessionId) {
        self.live.remove(&session);
        self.store.remove(&session);
        if let Some((_, token)) = self.tokens.remove(&session) {
            self.mcp.release_dyn(&token);
        }
    }
}

/// The state a cold attach builds for `facts` from its logged `frames`.
fn rebuilt_state(
    facts: &SessionFacts,
    frames: Vec<agent_session::domain::model::Message>,
) -> SessionState {
    let restored_effort = replay_reasoning_effort(&frames);
    let reasoning_effort =
        if agent::ReasoningEffort::supported(&facts.model).contains(&restored_effort) {
            restored_effort
        } else {
            agent::ReasoningEffort::default()
        };
    let restored_speed = replay_speed(&frames);
    let speed = if restored_speed.supported(&facts.model) {
        restored_speed
    } else {
        agent::ModelSpeed::Standard
    };
    SessionState {
        acp_session_id: facts.acp_session_id.clone(),
        model: facts.model.clone(),
        reasoning_effort,
        speed,
        identity: facts.identity.clone(),
        instructions: facts.instructions.clone(),
        history: replay_history(frames),
        summarizing: Summarizing::default(),
    }
}

/// `history` as a turn's model messages are built from it: without reasoning
/// parts, with the text parts that leaves next to each other read as one, and
/// without assistant entries that held nothing else.
fn model_history(history: &[HistoryEntry]) -> Vec<HistoryEntry> {
    history
        .iter()
        .filter_map(|entry| match entry {
            HistoryEntry::Assistant(parts) => {
                let parts = agent::merge_consecutive_parts(
                    parts
                        .iter()
                        .filter(|part| {
                            !matches!(part, agent::types::AssistantMessagePart::Thinking { .. })
                        })
                        .cloned()
                        .collect(),
                );
                (!parts.is_empty()).then_some(HistoryEntry::Assistant(parts))
            }
            other => Some(other.clone()),
        })
        .collect()
}
