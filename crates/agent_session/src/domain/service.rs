//! The agent session domain service.
//!
//! Inbound adapters (the axum router) depend on [`AgentSessionService`]
//! rather than the repo ports directly, so the transport surface only sees
//! the use cases it needs and the wiring of concrete repos stays in the
//! composition root.

use super::error::Result;
use super::model::{AgentSession, AgentSessionId, AgentSessionLog, CreateAgentSessionParams};
use super::ports::{AgentSessionLogRepo, AgentSessionRepo};

/// The use cases the agent session HTTP surface exposes.
///
/// `Send + Sync + 'static` with `Send` futures for the same reason as the
/// repo ports: callers drive sessions from spawned tasks.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionService: Send + Sync + 'static {
    /// Create a new agent session with its dedicated channel.
    fn create_session(
        &self,
        params: CreateAgentSessionParams,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Get an agent session by id.
    fn get_session(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Replace an existing agent session.
    fn update_session(&self, session: AgentSession) -> impl Future<Output = Result<()>> + Send;

    /// Delete an agent session by id.
    fn delete_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Append a protocol event to a session's log.
    fn append_event(&self, log: AgentSessionLog) -> impl Future<Output = Result<()>> + Send;
}

/// Concrete [`AgentSessionService`] backed by the repo ports.
///
/// `R` is the persistence adapter implementing both [`AgentSessionRepo`] and
/// [`AgentSessionLogRepo`], e.g. `outbound::postgres::PgAgentSessionRepo`.
pub struct AgentSessionServiceImpl<R> {
    repo: R,
}

impl<R> AgentSessionServiceImpl<R> {
    /// Create a new service from its persistence port.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> AgentSessionService for AgentSessionServiceImpl<R>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Send + Sync + 'static,
{
    async fn create_session(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        AgentSessionRepo::create(&self.repo, params).await
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

    async fn append_event(&self, log: AgentSessionLog) -> Result<()> {
        AgentSessionLogRepo::create(&self.repo, log).await
    }
}
