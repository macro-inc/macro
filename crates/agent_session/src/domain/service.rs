//! Persistence and active lifecycle management for agent sessions.
//!
//! Inbound adapters depend on [`AgentSessionService`] rather than repository
//! ports. Protocol decisions live in [`super::session`]'s pure machine, and
//! each connection's effects are executed by its actor shell.

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
const COMMAND_BUFFER: usize = 1028;

type ActiveSessions = DashMap<AgentSessionId, mpsc::Sender<SessionCommand>>;

/// Durable and live use cases for agent sessions.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionService: Send + Sync + 'static {
    /// Persist a session and attach its already-provisioned transport.
    fn create_session<Connector>(
        &self,
        params: CreateAgentSessionParams,
        connector: Connector,
    ) -> impl Future<Output = Result<AgentSession>> + Send
    where
        Connector: AgentConnector + Clone;

    /// Get a persisted agent session by id.
    fn get_session(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Replace an existing agent session.
    fn update_session(&self, session: AgentSession) -> impl Future<Output = Result<()>> + Send;

    /// Delete an agent session by id.
    fn delete_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Attach a new transport to an existing persisted session.
    fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        connector: Connector,
    ) -> impl Future<Output = Result<()>> + Send
    where
        Connector: AgentConnector + Clone;

    /// Deliver an action through the session's active transport.
    fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Agent session service backed by one durable repository and local actors.
pub struct AgentSessionServiceImpl<R> {
    repo: R,
    active: Arc<ActiveSessions>,
}

impl<R> AgentSessionServiceImpl<R> {
    /// Build a service from a repository implementing both session ports.
    pub fn new(repo: R) -> Self {
        Self {
            repo,
            active: Arc::new(DashMap::new()),
        }
    }

    fn register_transport<Connector>(&self, id: AgentSessionId, connector: Connector) -> Result<()>
    where
        R: AgentSessionLogRepo + Clone,
        Connector: AgentConnector + Clone,
    {
        let (commands, command_rx) = mpsc::channel(COMMAND_BUFFER);

        match self.active.entry(id) {
            Entry::Occupied(_) => return Err(AgentSessionError::AlreadyConnected(id)),
            Entry::Vacant(entry) => {
                entry.insert(commands);
            }
        }

        let actor = SessionActor::new(id, connector, self.repo.clone(), command_rx);
        tokio::spawn(run_session(actor, Arc::downgrade(&self.active)));
        Ok(())
    }
}

impl<R> AgentSessionService for AgentSessionServiceImpl<R>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
{
    async fn create_session<Connector>(
        &self,
        params: CreateAgentSessionParams,
        connector: Connector,
    ) -> Result<AgentSession>
    where
        Connector: AgentConnector + Clone,
    {
        let session = AgentSessionRepo::create(&self.repo, params).await?;
        self.register_transport(session.id, connector)?;
        Ok(session)
    }

    async fn get_session(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn update_session(&self, session: AgentSession) -> Result<()> {
        self.repo.update(session).await
    }

    async fn delete_session(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }

    async fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        connector: Connector,
    ) -> Result<()>
    where
        Connector: AgentConnector + Clone,
    {
        let session = self.repo.get(id).await?;
        self.register_transport(session.id, connector)
    }

    async fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let commands = self
            .active
            .get(&id)
            .map(|entry| entry.value().clone())
            .ok_or(AgentSessionError::Disconnected(id))?;

        let (completed, result) = oneshot::channel();
        commands
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

/// Step the actor until its machine stops, then release the registry entry.
async fn run_session<Connector, Logs>(
    mut actor: SessionActor<Connector, Logs>,
    active: std::sync::Weak<ActiveSessions>,
) where
    Connector: AgentConnector + Clone,
    Logs: AgentSessionLogRepo,
{
    while actor.step().await == Stepped::Continue {}

    // Refuse late commands before releasing the registry entry, so a caller
    // cannot enqueue into an actor that will never step again.
    actor.close();
    let id = actor.id();

    // Tear down the old transport before allowing another actor to attach.
    drop(actor);
    if let Some(active) = active.upgrade() {
        active.remove(&id);
    }
}
