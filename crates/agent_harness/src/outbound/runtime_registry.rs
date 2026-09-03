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

use agent_runtime_protocol::domain::ports::{Transport, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::connection::{RuntimeAttachment, RuntimeConnection, SessionChannel};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use dashmap::DashMap;
use harness_id::HarnessId;

use crate::domain::ports::{HarnessBindings, RuntimeBinding, RuntimeConnections, RuntimeLease};

#[cfg(not(test))]
const PENDING_ATTACH_WAIT: Duration = Duration::from_secs(5);
#[cfg(test)]
const PENDING_ATTACH_WAIT: Duration = Duration::from_millis(25);

#[cfg(test)]
mod test;

/// Every harness's live runtime connection.
pub struct RuntimeRegistry<Sender> {
    connections: DashMap<HarnessId, (macro_uuid::Uuid, Arc<RuntimeConnection<Sender>>)>,
    attached: tokio::sync::Notify,
    lease: Option<(
        agent_session::domain::model::ReplicaId,
        Arc<dyn RuntimeLease>,
    )>,
}

impl<Sender> Default for RuntimeRegistry<Sender> {
    fn default() -> Self {
        Self {
            connections: DashMap::new(),
            attached: tokio::sync::Notify::new(),
            lease: None,
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

    /// An empty registry that releases exact leases on close.
    #[must_use]
    pub fn with_lease(
        replica: agent_session::domain::model::ReplicaId,
        lease: Arc<dyn RuntimeLease>,
    ) -> Arc<Self> {
        Arc::new(Self {
            connections: DashMap::new(),
            attached: tokio::sync::Notify::new(),
            lease: Some((replica, lease)),
        })
    }

    /// Whether a harness currently has a runtime connected.
    #[must_use]
    pub fn is_connected(&self, harness: HarnessId) -> bool {
        self.connections.contains_key(&harness)
    }

    #[cfg(test)]
    pub(crate) fn connection_id(&self, harness: HarnessId) -> Option<macro_uuid::Uuid> {
        self.connections.get(&harness).map(|entry| entry.0)
    }

    fn owns(&self, harness: HarnessId, owner: &crate::domain::model::RuntimeOwner) -> bool {
        self.lease.as_ref().is_some_and(|(replica, _)| {
            *replica == owner.replica
                && self
                    .connections
                    .get(&harness)
                    .is_some_and(|connection| connection.0 == owner.connection_id)
        })
    }
}

impl<Sender> RuntimeRegistry<Sender>
where
    Sender: TransportSender<ToRuntimeMessage>,
{
    /// Attach a test or single-process runtime with a freshly minted token.
    pub fn attach<Carrier>(self: &Arc<Self>, harness: HarnessId, carrier: Carrier) -> bool
    where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let connection = RuntimeConnection::connect(carrier);
        let connection_id = macro_uuid::Uuid::new_v4();
        if let Some((_, displaced)) = self
            .connections
            .insert(harness, (connection_id, Arc::clone(&connection)))
        {
            displaced.evict();
        }
        self.attached.notify_waiters();
        self.watch_for_close(harness, connection_id, connection);
        true
    }

    /// Attach the socket whose durable claim is `connection_id`.
    pub fn attach_with_id<Carrier>(
        self: &Arc<Self>,
        harness: HarnessId,
        connection_id: macro_uuid::Uuid,
        carrier: Carrier,
    ) where
        Carrier: Transport<ToRuntimeMessage, ToServerMessage, Sender = Sender>,
    {
        let connection = RuntimeConnection::connect(carrier);

        // Listed before it is watched: a socket that dies immediately would
        // otherwise have its eviction run before the entry it is meant to
        // remove exists, leaving the dead connection listed for good.
        if let Some((_, displaced)) = self
            .connections
            .insert(harness, (connection_id, Arc::clone(&connection)))
        {
            displaced.evict();
        }
        self.attached.notify_waiters();
        self.watch_for_close(harness, connection_id, connection);
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
        connection_id: macro_uuid::Uuid,
        connection: Arc<RuntimeConnection<Sender>>,
    ) {
        tokio::spawn(Arc::clone(self).drop_when_closed(harness, connection_id, connection));
    }

    /// The body of that watch: wait for the end, then unlist it.
    ///
    /// Separate from the spawn so a test can await the whole thing rather than
    /// race a task it has no handle on.
    async fn drop_when_closed(
        self: Arc<Self>,
        harness: HarnessId,
        connection_id: macro_uuid::Uuid,
        connection: Arc<RuntimeConnection<Sender>>,
    ) {
        connection.closed().await;
        // Only if it is still this exact token: a newer dial must remain
        // listed, and a stale close must not release its durable lease.
        let removed = self
            .connections
            .remove_if(&harness, |_, current| {
                current.0 == connection_id && Arc::ptr_eq(&current.1, &connection)
            })
            .is_some();
        if removed {
            if let Some((replica, lease)) = &self.lease {
                let lease = Arc::clone(lease);
                let replica = *replica;
                tokio::spawn(async move {
                    loop {
                        match lease.release(harness, replica, connection_id).await {
                            Ok(()) => break,
                            Err(error) => {
                                tracing::error!(error = ?error, %harness, "failed to release closed runtime socket lease; retrying");
                                tokio::time::sleep(Duration::from_secs(1)).await;
                            }
                        }
                    }
                });
            }
            tracing::info!(%harness, "dropped this harness's closed runtime connection");
        }
    }

    /// Remove a socket only when it still holds `connection_id`.
    pub fn remove_and_evict(&self, harness: HarnessId, connection_id: macro_uuid::Uuid) {
        if let Some((_, (_, connection))) = self
            .connections
            .remove_if(&harness, |_, current| current.0 == connection_id)
        {
            connection.evict();
        }
    }

    /// Evict local sockets whose exact durable ownership has been superseded.
    pub async fn reconcile(&self) {
        let Some((replica, lease)) = &self.lease else {
            return;
        };
        let local = self
            .connections
            .iter()
            .map(|entry| (*entry.key(), entry.value().0))
            .collect::<Vec<_>>();
        for (harness, connection_id) in local {
            match lease.owner(harness).await {
                Ok(Some(owner))
                    if owner.replica == *replica && owner.connection_id == connection_id => {}
                Ok(_) => self.remove_and_evict(harness, connection_id),
                Err(error) => {
                    tracing::warn!(error = ?error, %harness, "failed to reconcile runtime socket ownership");
                }
            }
        }
    }

    async fn bind(
        &self,
        harness: HarnessId,
        session: AgentSessionId,
        connection_id: macro_uuid::Uuid,
        pending_until: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Option<RuntimeAttachment<SessionChannel<Sender>>> {
        let remaining = pending_until
            .map(|deadline| {
                (deadline - chrono::Utc::now())
                    .to_std()
                    .unwrap_or(Duration::ZERO)
            })
            .unwrap_or(PENDING_ATTACH_WAIT)
            .min(PENDING_ATTACH_WAIT);
        let deadline = tokio::time::Instant::now() + remaining;
        loop {
            let notified = self.attached.notified();
            if let Some(connection) = self
                .connections
                .get(&harness)
                .filter(|entry| entry.0 == connection_id)
                .map(|entry| Arc::clone(&entry.1))
            {
                return Some(connection.bind(session).await);
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return None;
            }
        }
    }

    async fn bind_any(
        &self,
        harness: HarnessId,
        session: AgentSessionId,
    ) -> Option<RuntimeAttachment<SessionChannel<Sender>>> {
        let connection = self
            .connections
            .get(&harness)
            .map(|entry| Arc::clone(&entry.1))?;
        Some(connection.bind(session).await)
    }
}

/// [`RuntimeConnections`] over the harness-keyed registry.
///
/// The domain binds sessions by bot; this resolves the bot's *current*
/// harness binding on every bind, so rebinding an agent to another harness
/// re-routes its existing sessions without restamping anything.
pub struct HarnessKeyedConnections<Bindings, Sender, Lease = crate::domain::ports::NoRuntimeLease> {
    bindings: Bindings,
    lease: Lease,
    registry: Arc<RuntimeRegistry<Sender>>,
}

impl<Bindings, Sender, Lease> HarnessKeyedConnections<Bindings, Sender, Lease> {
    /// Wrap the registry with a bot-to-harness resolver.
    pub fn with_lease(
        bindings: Bindings,
        lease: Lease,
        registry: Arc<RuntimeRegistry<Sender>>,
    ) -> Self {
        Self {
            bindings,
            lease,
            registry,
        }
    }
}

impl<Bindings, Sender>
    HarnessKeyedConnections<Bindings, Sender, crate::domain::ports::NoRuntimeLease>
{
    /// Wrap a registry without durable routing, for tests and local tooling.
    pub fn new(bindings: Bindings, registry: Arc<RuntimeRegistry<Sender>>) -> Self {
        Self::with_lease(bindings, crate::domain::ports::NoRuntimeLease, registry)
    }
}

impl<Bindings, Sender, Lease> RuntimeConnections
    for HarnessKeyedConnections<Bindings, Sender, Lease>
where
    Bindings: HarnessBindings,
    Lease: RuntimeLease,
    Sender: TransportSender<ToRuntimeMessage>,
{
    type Connector = SessionChannel<Sender>;

    async fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> Option<RuntimeBinding<SessionChannel<Sender>>> {
        let harness = match self.bindings.harness_for(bot).await {
            Ok(Some(harness)) => harness,
            Ok(None) => return None,
            Err(error) => {
                tracing::error!(error = ?error, %bot, "bot-to-harness resolution failed");
                return None;
            }
        };
        if self.registry.lease.is_none() {
            return self
                .registry
                .bind_any(harness, session)
                .await
                .map(|attachment| RuntimeBinding {
                    attachment,
                    harness,
                    connection_id: macro_uuid::Uuid::nil(),
                });
        }
        let owner = match self.lease.owner(harness).await {
            Ok(Some(owner)) => owner,
            Ok(None) => return None,
            Err(error) => {
                tracing::error!(error = ?error, %harness, "runtime owner resolution failed");
                return None;
            }
        };
        if !self
            .registry
            .lease
            .as_ref()
            .is_some_and(|(replica, _)| *replica == owner.replica)
        {
            return None;
        }
        let attachment = self
            .registry
            .bind(harness, session, owner.connection_id, owner.pending_until)
            .await?;
        let current = match self.lease.owner(harness).await {
            Ok(owner) => owner,
            Err(error) => {
                tracing::error!(error = ?error, %harness, "runtime owner revalidation failed");
                return None;
            }
        };
        if current.as_ref().is_some_and(|current| {
            current.replica == owner.replica && current.connection_id == owner.connection_id
        }) {
            Some(RuntimeBinding {
                attachment,
                harness,
                connection_id: owner.connection_id,
            })
        } else {
            None
        }
    }

    async fn bound_harness(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        self.bindings.harness_for(bot).await
    }

    async fn runtime_owner(
        &self,
        harness: HarnessId,
    ) -> anyhow::Result<Option<crate::domain::model::RuntimeOwner>> {
        self.lease.owner(harness).await
    }

    fn owns_runtime(&self, harness: HarnessId, owner: &crate::domain::model::RuntimeOwner) -> bool {
        self.registry.owns(harness, owner)
    }

    fn is_local_runtime_owner(&self, owner: &crate::domain::model::RuntimeOwner) -> bool {
        self.registry
            .lease
            .as_ref()
            .is_some_and(|(replica, _)| *replica == owner.replica)
    }

    fn requires_runtime_owner(&self) -> bool {
        self.registry.lease.is_some()
    }
}
