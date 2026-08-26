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

use agent_runtime_protocol::domain::ports::{Transport, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::connection::{RuntimeAttachment, RuntimeConnection, SessionChannel};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use dashmap::DashMap;

use crate::domain::ports::RuntimeConnections;

#[cfg(test)]
mod test;

/// Every bot's live runtime connection.
pub struct RuntimeRegistry<Sender> {
    connections: DashMap<BotId, Arc<RuntimeConnection<Sender>>>,
}

impl<Sender> Default for RuntimeRegistry<Sender> {
    fn default() -> Self {
        Self {
            connections: DashMap::new(),
        }
    }
}

impl<Sender> RuntimeRegistry<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
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

impl<Sender> RuntimeRegistry<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    /// Take over as `bot`'s connection, displacing whatever it had.
    ///
    /// Last dial wins: a runtime that redials has necessarily lost its old
    /// socket, and the sessions it was carrying rebind as they are next used.
    pub fn attach<Carrier>(self: &Arc<Self>, bot: BotId, carrier: Carrier)
    where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let connection = RuntimeConnection::connect(carrier);

        // Listed before it is watched: a socket that dies immediately would
        // otherwise have its eviction run before the entry it is meant to
        // remove exists, leaving the dead connection listed for good.
        if let Some(displaced) = self.connections.insert(bot, Arc::clone(&connection)) {
            displaced.evict();
            tracing::info!(%bot, "a redialed runtime replaced this bot's connection");
        }
        self.watch_for_close(bot, connection);
    }

    /// Drop `connection` from the registry once its transport ends.
    ///
    /// Without this, a bot whose runtime went away keeps an entry that
    /// [`RuntimeConnections::bind`] will hand out: sessions attach to a closed
    /// socket, their handshake writes succeed into nothing, and every prompt
    /// fails until some later dial happens to displace it. A registry of live
    /// connections has to stop listing the dead ones.
    fn watch_for_close(self: &Arc<Self>, bot: BotId, connection: Arc<RuntimeConnection<Sender>>) {
        tokio::spawn(Arc::clone(self).drop_when_closed(bot, connection));
    }

    /// The body of that watch: wait for the end, then unlist it.
    ///
    /// Separate from the spawn so a test can await the whole thing rather than
    /// race a task it has no handle on.
    async fn drop_when_closed(
        self: Arc<Self>,
        bot: BotId,
        connection: Arc<RuntimeConnection<Sender>>,
    ) {
        connection.closed().await;
        // Only if it is still this connection: a redial that already replaced
        // it owns the entry now, and evicting that would take the live socket
        // down along with the dead one.
        let removed = self
            .connections
            .remove_if(&bot, |_, current| Arc::ptr_eq(current, &connection))
            .is_some();
        if removed {
            tracing::info!(%bot, "dropped this bot's closed runtime connection");
        }
    }
}

impl<Sender> RuntimeConnections for Arc<RuntimeRegistry<Sender>>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    type Connector = SessionChannel<Sender>;

    async fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> Option<RuntimeAttachment<SessionChannel<Sender>>> {
        let connection = self.connections.get(&bot).map(|entry| Arc::clone(&entry))?;
        Some(connection.bind(session).await)
    }
}
