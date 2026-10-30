//! The live runtime connections, one per harness that has dialed in.
//!
//! Held here rather than in the domain because a connection is liveness: it
//! exists while a socket does, so it is never persisted and never survives a
//! restart. What is durable is each session's `acp_session_id`, which is how a
//! session re-establishes itself on whatever process dials in next.
//!
//! One entry per harness. A harness's runtime dials once and carries every
//! session of every agent bound to it, so this is what makes many ACP sessions
//! - across many bots - share one harness process.

use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::v1::SessionId;

use agent_runtime_protocol::domain::ports::{Transport, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::connection::{RuntimeAttachment, RuntimeConnection, SessionChannel};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use dashmap::DashMap;
use harness_id::HarnessId;
use tokio::sync::mpsc;

use crate::domain::ports::{HarnessBindings, HarnessPresence, RuntimeConnections};

#[cfg(test)]
mod test;

/// How long a dialed-in runtime has to list the sessions it still serves.
const LIVE_SESSIONS_TIMEOUT: Duration = Duration::from_secs(30);

/// ACP sessions a runtime that just dialed in for `harness` still serves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveRuntimeSessions {
    /// The harness the runtime dialed in for.
    pub harness: HarnessId,
    /// Its agents' live ACP sessions.
    pub acp_sessions: Vec<SessionId>,
}

/// Every harness's live runtime connection.
pub struct RuntimeRegistry<Sender> {
    connections: DashMap<HarnessId, Arc<RuntimeConnection<Sender>>>,
    presence: Option<Arc<dyn HarnessPresence>>,
    live_sessions: Option<mpsc::UnboundedSender<LiveRuntimeSessions>>,
}

impl<Sender> Default for RuntimeRegistry<Sender> {
    fn default() -> Self {
        Self {
            connections: DashMap::new(),
            presence: None,
            live_sessions: None,
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

    /// An empty registry that reports attach/detach to `presence` and the
    /// sessions each dialed-in runtime still serves to `live_sessions`.
    #[must_use]
    pub fn with_presence(
        presence: Arc<dyn HarnessPresence>,
        live_sessions: mpsc::UnboundedSender<LiveRuntimeSessions>,
    ) -> Arc<Self> {
        Arc::new(Self {
            connections: DashMap::new(),
            presence: Some(presence),
            live_sessions: Some(live_sessions),
        })
    }

    /// An empty registry that reports the sessions each dialed-in runtime
    /// still serves to `live_sessions`.
    #[must_use]
    pub fn reporting_live_sessions(
        live_sessions: mpsc::UnboundedSender<LiveRuntimeSessions>,
    ) -> Arc<Self> {
        Arc::new(Self {
            live_sessions: Some(live_sessions),
            ..Self::default()
        })
    }

    /// Whether a harness currently has a runtime connected.
    #[must_use]
    pub fn is_connected(&self, harness: HarnessId) -> bool {
        self.connections.contains_key(&harness)
    }

    /// Ask a harness's live runtime to probe a fresh ACP process.
    ///
    /// Returns `None` when no live connection exists. The caller owns the
    /// request deadline because timeout is use-case policy.
    pub async fn probe_models(
        &self,
        harness: HarnessId,
    ) -> Option<
        Result<
            Vec<agent_client_protocol::schema::v1::SessionConfigOption>,
            agent_session::domain::connection::ModelProbeError,
        >,
    > {
        let connection = self
            .connections
            .get(&harness)
            .map(|entry| Arc::clone(&entry))?;
        Some(connection.probe_models().await)
    }
}

impl<Sender> RuntimeRegistry<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    /// Take over as `harness`'s connection, displacing whatever it had.
    ///
    /// Last dial wins: a runtime that redials has necessarily lost its old
    /// socket. Sessions whose agents outlived it are reported to
    /// `live_sessions` to be loaded again; the rest rebind as they are next
    /// used.
    pub fn attach<Carrier>(self: &Arc<Self>, harness: HarnessId, carrier: Carrier)
    where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let connection = RuntimeConnection::connect(carrier);

        // Listed before it is watched: a socket that dies immediately would
        // otherwise have its eviction run before the entry it is meant to
        // remove exists, leaving the dead connection listed for good.
        if let Some(displaced) = self.connections.insert(harness, Arc::clone(&connection)) {
            displaced.evict();
            tracing::info!(%harness, "a redialed runtime replaced this harness's connection");
        }
        if let Some(presence) = &self.presence {
            tokio::spawn(Arc::clone(presence).connected(harness));
        }
        if let Some(live_sessions) = &self.live_sessions {
            tokio::spawn(report_live_sessions(
                harness,
                Arc::clone(&connection),
                live_sessions.clone(),
            ));
        }
        self.watch_for_close(harness, connection);
    }

    /// Drop `connection` from the registry once its transport ends.
    ///
    /// Without this, a harness whose runtime went away keeps an entry that
    /// [`RuntimeConnections::bind`] will hand out: sessions attach to a closed
    /// socket, their handshake writes succeed into nothing, and every prompt
    /// fails until some later dial happens to displace it. A registry of live
    /// connections has to stop listing the dead ones.
    fn watch_for_close(
        self: &Arc<Self>,
        harness: HarnessId,
        connection: Arc<RuntimeConnection<Sender>>,
    ) {
        tokio::spawn(Arc::clone(self).drop_when_closed(harness, connection));
    }

    /// The body of that watch: wait for the end, then unlist it.
    ///
    /// Separate from the spawn so a test can await the whole thing rather than
    /// race a task it has no handle on.
    async fn drop_when_closed(
        self: Arc<Self>,
        harness: HarnessId,
        connection: Arc<RuntimeConnection<Sender>>,
    ) {
        connection.closed().await;
        // Only if it is still this connection: a redial that already replaced
        // it owns the entry now, and evicting that would take the live socket
        // down along with the dead one. The presence write follows the same
        // rule, so a displaced socket's death never marks the live redial
        // disconnected.
        let removed = self
            .connections
            .remove_if(&harness, |_, current| Arc::ptr_eq(current, &connection))
            .is_some();
        if removed {
            if let Some(presence) = &self.presence {
                tokio::spawn(Arc::clone(presence).disconnected(harness));
            }
            tracing::info!(%harness, "dropped this harness's closed runtime connection");
        }
    }
}

/// Ask a new connection which sessions its runtime still serves.
///
/// Runtimes without the extension answer with an error, which is the
/// ordinary "none" and not worth more than a debug line.
#[tracing::instrument(
    name = "agent.runtime.live_sessions",
    skip_all,
    fields(%harness, agent.runtime.live_sessions = tracing::field::Empty)
)]
async fn report_live_sessions<Sender>(
    harness: HarnessId,
    connection: Arc<RuntimeConnection<Sender>>,
    live_sessions: mpsc::UnboundedSender<LiveRuntimeSessions>,
) where
    Sender: TransportSender<ToRuntimeMessage>,
{
    let acp_sessions =
        match tokio::time::timeout(LIVE_SESSIONS_TIMEOUT, connection.live_sessions()).await {
            Ok(Ok(acp_sessions)) => acp_sessions,
            Ok(Err(error)) => {
                tracing::debug!(error = %error, "the runtime listed no live sessions");
                return;
            }
            Err(_) => {
                tracing::warn!("the runtime did not list its live sessions in time");
                return;
            }
        };
    tracing::Span::current().record("agent.runtime.live_sessions", acp_sessions.len());
    if acp_sessions.is_empty() {
        return;
    }
    let _ = live_sessions.send(LiveRuntimeSessions {
        harness,
        acp_sessions,
    });
}

/// [`RuntimeConnections`] over the harness-keyed registry.
///
/// The domain binds sessions by bot; this resolves the bot's *current*
/// harness binding on every bind, so rebinding an agent to another harness
/// re-routes its existing sessions without restamping anything.
pub struct HarnessKeyedConnections<Bindings, Sender> {
    bindings: Bindings,
    registry: Arc<RuntimeRegistry<Sender>>,
}

impl<Bindings, Sender> HarnessKeyedConnections<Bindings, Sender> {
    /// Wrap the registry with a bot-to-harness resolver.
    pub fn new(bindings: Bindings, registry: Arc<RuntimeRegistry<Sender>>) -> Self {
        Self { bindings, registry }
    }
}

impl<Bindings, Sender> RuntimeConnections for HarnessKeyedConnections<Bindings, Sender>
where
    Bindings: HarnessBindings,
    Sender: TransportSender<ToRuntimeMessage>,
{
    type Connector = SessionChannel<Sender>;

    async fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> Option<RuntimeAttachment<SessionChannel<Sender>>> {
        let harness = match self.bindings.harness_for(bot).await {
            Ok(Some(harness)) => harness,
            Ok(None) => return None,
            Err(error) => {
                tracing::error!(error = ?error, %bot, "bot-to-harness resolution failed");
                return None;
            }
        };
        let connection = self
            .registry
            .connections
            .get(&harness)
            .map(|entry| Arc::clone(&entry))?;
        Some(connection.bind(session).await)
    }

    async fn bound_harness(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        self.bindings.harness_for(bot).await
    }

    fn is_connected(&self, harness: HarnessId) -> bool {
        self.registry.is_connected(harness)
    }

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<Vec<AgentSessionId>> {
        self.bindings
            .sessions_on_harness(harness, acp_sessions)
            .await
    }
}
