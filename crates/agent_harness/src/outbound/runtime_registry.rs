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
use agent_session::domain::connection::{
    ListedSession, RuntimeAttachment, RuntimeConnection, SessionChannel,
};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use dashmap::DashMap;
use harness_id::HarnessId;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::Instrument as _;

use crate::domain::ports::{
    ConnectionRecorded, HarnessBindings, HarnessPresence, RuntimeAccepts, RuntimeConnectionId,
    RuntimeConnections, TeammateEvent, TeammateReport,
};

#[cfg(test)]
mod test;

/// How long a dialed-in runtime has to list the sessions it still serves.
const LIVE_SESSIONS_TIMEOUT: Duration = Duration::from_secs(30);

/// ACP sessions a runtime that just dialed in for `harness` still serves.
#[derive(Debug, Clone)]
pub struct LiveRuntimeSessions {
    /// The harness the runtime dialed in for.
    pub harness: HarnessId,
    /// Its agents' live ACP sessions, with when each last saw activity.
    pub acp_sessions: Vec<ListedSession>,
    /// The span that asked, for reattaching to follow from.
    pub span: tracing::Span,
}

/// A connection and the identity its presence reports carry.
struct ListedConnection<Sender> {
    /// Always `connection.id()`.
    id: RuntimeConnectionId,
    connection: Arc<RuntimeConnection<Sender>>,
    accepts: RuntimeAccepts,
}

// Manual Clone impl: the sender itself is behind the Arc.
impl<Sender> Clone for ListedConnection<Sender> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            connection: Arc::clone(&self.connection),
            accepts: self.accepts,
        }
    }
}

/// Every harness's live runtime connection.
pub struct RuntimeRegistry<Sender> {
    connections: DashMap<HarnessId, ListedConnection<Sender>>,
    presence: Option<Arc<dyn HarnessPresence>>,
    live_sessions: Option<mpsc::UnboundedSender<LiveRuntimeSessions>>,
    /// Where runtimes' teammate hosting reports go, once someone delivers
    /// teammates on this replica.
    teammate_reports: std::sync::OnceLock<mpsc::UnboundedSender<TeammateReport>>,
}

impl<Sender> Default for RuntimeRegistry<Sender> {
    fn default() -> Self {
        Self {
            connections: DashMap::new(),
            presence: None,
            live_sessions: None,
            teammate_reports: std::sync::OnceLock::new(),
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
            presence: Some(presence),
            live_sessions: Some(live_sessions),
            ..Self::default()
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

    /// Hand every teammate hosting report of connections attached from now
    /// on to `reports`. Set once; a second call is ignored.
    pub fn report_teammates_to(&self, reports: mpsc::UnboundedSender<TeammateReport>) {
        let _ = self.teammate_reports.set(reports);
    }

    /// Whether a harness currently has a runtime connected.
    #[must_use]
    pub fn is_connected(&self, harness: HarnessId) -> bool {
        self.connections.contains_key(&harness)
    }

    /// The dial a harness's runtime is connected on here, if any.
    #[must_use]
    pub fn connection_of(&self, harness: HarnessId) -> Option<RuntimeConnectionId> {
        self.connections.get(&harness).map(|listed| listed.id)
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
            .map(|entry| Arc::clone(&entry.connection))?;
        Some(connection.probe_models().await)
    }

    /// The dial `harness`'s runtime is connected on here, and whether it
    /// hosts agent teammates in containers.
    pub fn teammate_dial(&self, harness: HarnessId) -> Option<(RuntimeConnectionId, bool)> {
        self.connections
            .get(&harness)
            .map(|listed| (listed.id, listed.accepts.teammate_container))
    }

    /// The dial `harness`'s runtime is connected on here, when it is that
    /// one and hosts teammates in containers.
    fn teammate_connection(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> Option<Arc<RuntimeConnection<Sender>>> {
        self.connections
            .get(&harness)
            .filter(|listed| listed.id == connection && listed.accepts.teammate_container)
            .map(|listed| Arc::clone(&listed.connection))
    }

    /// Send `RunTeammate`, carrying the sender's `traceparent`, down
    /// `harness`'s runtime on `connection`. Whether
    /// it was sent: false when that dial is gone or can't host teammates.
    pub async fn run_teammate(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: agent_runtime_protocol::domain::schema::v0::TeammateInstall,
        image: agent_runtime_protocol::domain::schema::v0::TeammateImage,
        environment: agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
        traceparent: Option<String>,
    ) -> bool {
        let Some(runtime) = self.teammate_connection(harness, connection) else {
            return false;
        };
        runtime
            .run_teammate(install, image, environment, traceparent)
            .await
            .inspect_err(|error| tracing::warn!(%harness, error = ?error, "could not send a teammate install"))
            .is_ok()
    }

    /// Ask `harness`'s runtime to check its teammate hosting again now, its
    /// check joining the trace of `traceparent`. Whether it was sent: false
    /// when it isn't connected here or didn't list the message.
    pub async fn recheck_teammate_host(
        &self,
        harness: HarnessId,
        traceparent: Option<String>,
    ) -> bool {
        let Some(runtime) = self
            .connections
            .get(&harness)
            .filter(|listed| listed.accepts.recheck_teammate_host)
            .map(|listed| Arc::clone(&listed.connection))
        else {
            return false;
        };
        runtime
            .recheck_teammate_host(traceparent)
            .await
            .inspect_err(|error| tracing::warn!(%harness, error = ?error, "could not ask a runtime to recheck its teammate hosting"))
            .is_ok()
    }

    /// Send `StopTeammate` down `harness`'s runtime on `connection`. Whether
    /// it was sent.
    pub async fn stop_teammate(
        &self,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        install: agent_runtime_protocol::domain::schema::v0::TeammateInstall,
        traceparent: Option<String>,
    ) -> bool {
        let Some(runtime) = self.teammate_connection(harness, connection) else {
            return false;
        };
        runtime
            .stop_teammate(install, traceparent)
            .await
            .inspect_err(|error| tracing::warn!(%harness, error = ?error, "could not stop a teammate install"))
            .is_ok()
    }

    /// Hand `harness`'s live runtime an agent teammate's environment, with
    /// the setup trace its start joins. Returns whether this process holds a
    /// connection for it.
    pub async fn apply_agent(
        &self,
        harness: HarnessId,
        environment: agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
        traceparent: Option<String>,
    ) -> bool {
        let Some(connection) = self
            .connections
            .get(&harness)
            .map(|entry| Arc::clone(&entry.connection))
        else {
            return false;
        };
        match connection.apply_agent(environment, traceparent).await {
            Ok(()) => {
                tracing::info!(%harness, "handed this harness's runtime its agent");
                true
            }
            Err(error) => {
                tracing::warn!(%harness, error = ?error, "could not hand this harness's runtime its agent");
                false
            }
        }
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
        self.attach_accepting(harness, carrier, RuntimeAccepts::default());
    }

    /// [`Self::attach`] a runtime that accepts the optional messages in
    /// `accepts`.
    pub fn attach_accepting<Carrier>(
        self: &Arc<Self>,
        harness: HarnessId,
        carrier: Carrier,
        accepts: RuntimeAccepts,
    ) where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let (teammate_sender, teammate_receiver) = match self.teammate_reports.get() {
            Some(reports) => {
                let (sender, receiver) = mpsc::unbounded_channel();
                (Some(sender), Some((receiver, reports.clone())))
            }
            None => (None, None),
        };
        let connection = RuntimeConnection::connect_reporting_teammates(carrier, teammate_sender);
        if let Some((receiver, reports)) = teammate_receiver {
            forward_teammate_reports(harness, connection.id(), receiver, reports);
        }
        let listed = ListedConnection {
            id: connection.id(),
            connection,
            accepts,
        };

        // Listed before it is watched: a socket that dies immediately would
        // otherwise have its eviction run before the entry it is meant to
        // remove exists, leaving the dead connection listed for good.
        if let Some(displaced) = self.connections.insert(harness, listed.clone()) {
            displaced.connection.evict();
            tracing::info!(
                %harness,
                connection = %listed.id,
                displaced_connection = %displaced.id,
                "a redialed runtime replaced this harness's connection"
            );
        }
        let connected_write = self.presence.as_ref().map(|presence| {
            tokio::spawn(record_connected(
                Arc::clone(presence),
                harness,
                listed.clone(),
            ))
        });
        if let Some(live_sessions) = &self.live_sessions {
            tokio::spawn(report_live_sessions(
                harness,
                Arc::clone(&listed.connection),
                live_sessions.clone(),
            ));
        }
        self.watch_for_close(harness, listed, connected_write);
    }

    /// Tell presence which connections this process still holds.
    ///
    /// A connection can close between the snapshot and the renewal's write,
    /// which then restores the row its close deleted. A close leaves the
    /// registry before it deletes its row, so a restored connection the
    /// registry no longer holds closed in between, and is closed again. Off
    /// the renewal's path: a close can wait on locks, and a late renewal lets
    /// every lease here lapse. Each undo runs inside this renewal's span, so
    /// the restore and its second close read as one trace; a replica holding
    /// nothing renews nothing and opens no span.
    pub async fn renew_presence(&self) {
        let Some(presence) = &self.presence else {
            return;
        };

        let live: Vec<_> = self
            .connections
            .iter()
            .map(|entry| (*entry.key(), entry.id))
            .collect();
        if live.is_empty() {
            return;
        }
        let span = tracing::info_span!(
            "harness.registry.renew",
            connections = live.len(),
            restored = tracing::field::Empty,
            undone = tracing::field::Empty,
        );
        let restored = Arc::clone(presence)
            .renew(live)
            .instrument(span.clone())
            .await;
        let _entered = span.enter();
        span.record("restored", restored.len());
        let mut undone = 0usize;
        for (harness, connection) in restored {
            if self.connection_of(harness) == Some(connection) {
                continue;
            }
            undone += 1;
            tracing::warn!(
                telemetry_event = "harness_runtime_lease_restore_undone",
                %harness,
                %connection,
                "a renewal restored a connection that closed while it ran; closing it again"
            );
            tokio::spawn(
                Arc::clone(presence)
                    .disconnected(harness, connection)
                    .instrument(span.clone()),
            );
        }
        span.record("undone", undone);
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
        listed: ListedConnection<Sender>,
        connected_write: Option<JoinHandle<()>>,
    ) {
        tokio::spawn(Arc::clone(self).drop_when_closed(harness, listed, connected_write));
    }

    /// The body of that watch: wait for the end, then unlist it.
    ///
    /// Separate from the spawn so a test can await the whole thing rather than
    /// race a task it has no handle on.
    async fn drop_when_closed(
        self: Arc<Self>,
        harness: HarnessId,
        listed: ListedConnection<Sender>,
        connected_write: Option<JoinHandle<()>>,
    ) {
        listed.connection.closed().await;
        // Only if it is still this connection: a redial that already replaced
        // it owns the entry now, and evicting that would take the live socket
        // down along with the dead one.
        let removed = self
            .connections
            .remove_if(&harness, |_, current| current.id == listed.id)
            .is_some();
        if let Some(presence) = &self.presence {
            // A socket that dies immediately must not have its close recorded
            // before its attach, which would leave the attach standing.
            if let Some(connected_write) = connected_write {
                let _ = connected_write.await;
            }
            Arc::clone(presence).disconnected(harness, listed.id).await;
        }
        if removed {
            tracing::info!(
                %harness,
                connection = %listed.id,
                "dropped this harness's closed runtime connection"
            );
        }
    }
}

/// Record a dial with presence, and when that bound an agent, tell the
/// runtime to re-read its agents.
///
/// A Macro computer gets its first agent on its first connect. Told now
/// rather than at its next poll, the runtime covers that agent at once, so a
/// session requested the moment the computer is ready reaches it. Only a
/// runtime that said it accepts the message gets it: an older one would log
/// every one it is sent as malformed.
async fn record_connected<Sender>(
    presence: Arc<dyn HarnessPresence>,
    harness: HarnessId,
    listed: ListedConnection<Sender>,
) where
    Sender: TransportSender<ToRuntimeMessage>,
{
    let recorded = presence.connected(harness, listed.id, listed.accepts).await;
    if recorded != ConnectionRecorded::AgentBound || !listed.accepts.agents_changed {
        return;
    }
    if let Err(error) = listed.connection.agents_changed().await {
        tracing::debug!(%harness, error = %error, "could not tell the runtime its agents changed");
    }
}

/// Initialize a new connection and ask which sessions its runtime serves.
///
/// An agent that does not advertise `session/list` lists none; an error
/// listing is not worth more than a debug line either.
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
    let listed = match tokio::time::timeout(LIVE_SESSIONS_TIMEOUT, connection.list_sessions()).await
    {
        Ok(Ok(listed)) => listed,
        Ok(Err(error)) => {
            tracing::debug!(error = %error, "the runtime listed no live sessions");
            return;
        }
        Err(_) => {
            tracing::warn!("the runtime did not list its live sessions in time");
            return;
        }
    };
    tracing::Span::current().record("agent.runtime.live_sessions", listed.len());
    if listed.is_empty() {
        return;
    }
    let _ = live_sessions.send(LiveRuntimeSessions {
        harness,
        acp_sessions: listed,
        span: tracing::Span::current(),
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
            .map(|entry| Arc::clone(&entry.connection))?;
        Some(connection.bind(session).await)
    }

    async fn bound_harness(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        self.bindings.harness_for(bot).await
    }

    fn is_connected(&self, harness: HarnessId) -> bool {
        self.registry.is_connected(harness)
    }

    fn connection_of(&self, harness: HarnessId) -> Option<RuntimeConnectionId> {
        self.registry.connection_of(harness)
    }

    async fn access_facts(
        &self,
        bot: BotId,
        actor: Option<&macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> anyhow::Result<Option<crate::domain::model::RuntimeAccessFacts>> {
        self.bindings.access_facts(bot, actor).await
    }

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<crate::domain::model::ListedSessions> {
        self.bindings
            .sessions_on_harness(harness, acp_sessions)
            .await
    }
}

/// Hand a connection's teammate reports from `receiver` to `reports`, tagged
/// with the harness and dial they came on. Ends with the connection.
fn forward_teammate_reports(
    harness: HarnessId,
    connection: RuntimeConnectionId,
    mut receiver: mpsc::UnboundedReceiver<ToServerMessage>,
    reports: mpsc::UnboundedSender<TeammateReport>,
) {
    tokio::spawn(async move {
        while let Some(message) = receiver.recv().await {
            let report = TeammateReport {
                harness,
                connection,
                event: TeammateEvent::Message(message),
            };
            if reports.send(report).is_err() {
                return;
            }
        }
        // The dial is gone: delivery forgets what it kept for it.
        let _ = reports.send(TeammateReport {
            harness,
            connection,
            event: TeammateEvent::Closed,
        });
    });
}
