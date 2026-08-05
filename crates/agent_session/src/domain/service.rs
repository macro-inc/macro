//! Persistence and active lifecycle management for agent sessions.
//!
//! Decisions live in [`super::session`]'s pure machine, and each connection's
//! effects are executed by its [`SessionActor`](super::session).

use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentAction;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot};

use super::error::{AgentSessionError, Result};
use super::model::{AgentSession, AgentSessionId, CreateAgentSessionParams};
use super::ports::{AgentConnector, AgentSessionLogRepo, AgentSessionRepo};
use super::session::actors::{SessionActor, SessionCommand, Stepped};

/// Buffered not-yet-accepted commands per session actor.
const COMMAND_BUFFER: usize = 64;

/// Persists agent sessions and manages their active transports.
pub struct AgentSessionService<Sessions, Logs> {
    sessions: Sessions,
    logs: Logs,
    registry: Arc<SessionRegistry>,
}

impl<Sessions, Logs> AgentSessionService<Sessions, Logs>
where
    Sessions: AgentSessionRepo,
    Logs: AgentSessionLogRepo + Clone,
{
    /// Build a session service from its persistence ports.
    pub fn new(sessions: Sessions, logs: Logs) -> Self {
        Self {
            sessions,
            logs,
            registry: Arc::new(SessionRegistry::default()),
        }
    }

    /// Persist and attach a new agent session to an already-provisioned transport.
    pub async fn create<Connector>(
        &self,
        params: CreateAgentSessionParams,
        connector: Connector,
    ) -> Result<AgentSession>
    where
        Connector: AgentConnector + Clone,
    {
        let session = self.sessions.create(params).await?;
        self.attach_session(session.id, connector)?;
        Ok(session)
    }

    /// Attach an existing persisted session to an already-provisioned transport.
    pub async fn attach<Connector>(&self, id: AgentSessionId, connector: Connector) -> Result<()>
    where
        Connector: AgentConnector + Clone,
    {
        let session = self.sessions.get(id).await?;
        self.attach_session(session.id, connector)
    }

    /// Deliver an action through the session's active transport.
    ///
    /// Completes once the action reaches the transport. Actions accepted while
    /// the transport boots remain queued until its ACP handshake completes.
    pub async fn send_message(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let handle = self
            .registry
            .sessions
            .get(&id)
            .map(|entry| entry.clone())
            .ok_or(AgentSessionError::Disconnected(id))?;

        handle.send(id, user_id, action).await
    }

    fn attach_session<Connector>(&self, id: AgentSessionId, connector: Connector) -> Result<()>
    where
        Connector: AgentConnector + Clone,
    {
        let (commands, command_rx) = mpsc::channel(COMMAND_BUFFER);
        let handle = SessionHandle { commands };

        match self.registry.sessions.entry(id) {
            Entry::Occupied(_) => return Err(AgentSessionError::AlreadyConnected(id)),
            Entry::Vacant(entry) => {
                entry.insert(handle);
            }
        }

        let actor = SessionActor::new(id, connector, self.logs.clone(), command_rx);
        tokio::spawn(run_session(actor, Arc::downgrade(&self.registry)));
        Ok(())
    }
}

#[derive(Clone)]
struct SessionHandle {
    commands: mpsc::Sender<SessionCommand>,
}

impl SessionHandle {
    async fn send(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let (completed, result) = oneshot::channel();
        self.commands
            .send(SessionCommand {
                user_id,
                action,
                completed,
            })
            .await
            .map_err(|_| AgentSessionError::Disconnected(id))?;
        result
            .await
            .map_err(|_| AgentSessionError::Disconnected(id))?
    }
}

#[derive(Default)]
struct SessionRegistry {
    sessions: DashMap<AgentSessionId, SessionHandle>,
}

/// Step the actor until its machine stops, then release the registry entry.
async fn run_session<Connector, Logs>(
    mut actor: SessionActor<Connector, Logs>,
    registry: std::sync::Weak<SessionRegistry>,
) where
    Connector: AgentConnector + Clone,
    Logs: AgentSessionLogRepo,
{
    while actor.step().await == Stepped::Continue {}

    // Refuse late commands before releasing the registry entry, so a caller
    // cannot enqueue into an actor that will never step again.
    actor.close();
    let id = actor.id();
    drop(actor);
    if let Some(registry) = registry.upgrade() {
        registry.sessions.remove(&id);
    }
}
