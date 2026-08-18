//! The live runtime connections, one per bot that has dialed in.
//!
//! Held here rather than in the domain because a connection is liveness: it
//! exists while a socket does, so it is never persisted and never survives a
//! restart. What is durable is each session's `acp_session_id`, which is how a
//! session re-establishes itself on whatever process dials in next.
//!
//! One entry per bot. A bot's runtime dials once and carries every session that
//! bot serves, so this is what makes many ACP sessions share one harness
//! process.

use std::sync::Arc;

use agent_session::domain::connection::{RuntimeAttachment, RuntimeConnection, SessionChannel};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::AgentConnector;
use bot_id::BotId;
use dashmap::DashMap;

use crate::domain::ports::RuntimeConnections;

#[cfg(test)]
mod test;

/// Every bot's live runtime connection.
pub struct RuntimeRegistry<Connector> {
    connections: DashMap<BotId, Arc<RuntimeConnection<Connector>>>,
}

impl<Connector> Default for RuntimeRegistry<Connector> {
    fn default() -> Self {
        Self {
            connections: DashMap::new(),
        }
    }
}

impl<Connector> RuntimeRegistry<Connector>
where
    Connector: AgentConnector,
{
    /// An empty registry.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Whether a bot currently has a runtime connected.
    #[must_use]
    pub fn is_connected(&self, bot: BotId) -> bool {
        self.connections.contains_key(&bot)
    }
}

impl<Connector> RuntimeRegistry<Connector>
where
    Connector: AgentConnector,
{
    /// Take over as `bot`'s connection, displacing whatever it had.
    ///
    /// Last dial wins: a runtime that redials has necessarily lost its old
    /// socket, and the sessions it was carrying rebind as they are next used.
    pub fn attach(self: &Arc<Self>, bot: BotId, connector: Connector) {
        let connection = RuntimeConnection::new(connector);
        // Routing runs for as long as the socket does; it ends by itself when
        // the transport closes, which closes every bound session's queue.
        tokio::spawn(Arc::clone(&connection).route_inbound());

        // Replacing drops the old connection's handle. Its router keeps running
        // until its socket closes, and the sessions on it fail their next
        // action - which rebinds them here.
        if self.connections.insert(bot, connection).is_some() {
            tracing::info!(%bot, "a redialed runtime replaced this bot's connection");
        }
    }
}

impl<Connector> RuntimeConnections for Arc<RuntimeRegistry<Connector>>
where
    Connector: AgentConnector,
{
    type Connector = SessionChannel<Connector>;

    async fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> Option<RuntimeAttachment<SessionChannel<Connector>>> {
        let connection = self.connections.get(&bot).map(|entry| Arc::clone(&entry))?;
        Some(connection.bind(session).await)
    }
}
