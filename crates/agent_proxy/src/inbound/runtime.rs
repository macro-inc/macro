//! Agent runtime connection driver.
//!
//! `agent_runtime_protocol` hosts exactly one agent execution per physical
//! connection and carries no session identifier on the wire (see
//! [`crate::domain::ports::RuntimeProvisioner`]). Correlating an accepted
//! connection to a chat/session id is therefore established out of band,
//! before the connection even exists: [`crate::domain::ports::RuntimeProvisioner`]
//! binds one dedicated listener per session and, once it accepts a
//! connection, hands `(session_id, channel)` to the composition root over a
//! plain channel. [`RuntimeConnectionDriver::run`] drains that channel and
//! drives each connection into the domain service.

use crate::domain::ports::SessionAttachments;
use crate::domain::service::AgentProxyService;
use crate::outbound::runtime_connections::ConnectionGuard;
use agent_runtime_protocol::domain::connection::{
    ServerChannel, ServerConnection, SystemEventHandler,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use futures::StreamExt;
use macro_uuid::Uuid;
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc::UnboundedReceiver;

/// Forwards system events from the connection driver into the connection
/// task, which owns the [`ServerConnection`] and can react to them.
struct ForwardSystemEvents {
    tx: tokio::sync::mpsc::UnboundedSender<SystemEvent>,
}

impl SystemEventHandler for ForwardSystemEvents {
    fn handle(&self, event: SystemEvent) -> impl Future<Output = ()> + Send {
        let _ = self.tx.send(event);
        std::future::ready(())
    }
}

/// Drains accepted runtime connections and drives each one into the domain
/// service until it closes.
///
/// Each connection is already known to belong to exactly one session (its
/// listener was bound for that session alone by
/// [`crate::domain::ports::RuntimeProvisioner`]), so unlike the previous
/// multi-agent-per-connection design, there is no routing table here: one
/// accepted connection is one session, full stop.
pub struct RuntimeConnectionDriver<S, A> {
    attachments: Arc<A>,
    service: Arc<S>,
    next_epoch: AtomicU64,
}

impl<S: AgentProxyService, A: SessionAttachments> RuntimeConnectionDriver<S, A> {
    /// Create a driver over the session registry and domain service.
    pub fn new(attachments: Arc<A>, service: Arc<S>) -> Self {
        Self {
            attachments,
            service,
            next_epoch: AtomicU64::new(0),
        }
    }

    /// Drain accepted `(session_id, channel, guard)` triples, spawning an
    /// independent task to drive each one so a slow or long-lived session
    /// never blocks another session's connection from being accepted and
    /// driven. The guard is held for the connection's whole lifetime: its
    /// listener must outlive the connection it accepted, not be torn down
    /// the moment it's handed off (see [`ConnectionGuard`]).
    pub async fn run(
        self: Arc<Self>,
        mut incoming: UnboundedReceiver<(Uuid, ServerChannel, ConnectionGuard)>,
    ) {
        while let Some((session_id, channel, guard)) = incoming.recv().await {
            let driver = Arc::clone(&self);
            tokio::spawn(async move { driver.drive(session_id, channel, guard).await });
        }
        tracing::info!("runtime connection source closed; driver stopping");
    }

    /// Attach one accepted connection's ACP channel to `session_id`, pump its
    /// traffic into the domain service, and clean up when it closes.
    async fn drive(&self, session_id: Uuid, channel: ServerChannel, _guard: ConnectionGuard) {
        let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);
        tracing::info!(%session_id, epoch, "agent runtime connected");

        let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();
        let (connection, acp) =
            ServerConnection::connect(channel, ForwardSystemEvents { tx: event_tx });

        let Some(registration) = self.attachments.register(session_id, epoch, acp.tx) else {
            // A newer connection already owns this session; dropping
            // `connection` (and the channel inside it) tears down the route
            // we just opened without disturbing the newer one.
            tracing::warn!(
                %session_id,
                epoch,
                "a newer connection owns this session; ignoring attach"
            );
            return;
        };

        // The ACP pump runs independently: per `agent_runtime_protocol`'s
        // design, dropping/ending the ACP sub-channel does not end system
        // event delivery on this connection - only the physical transport
        // closing does (see `agent_runtime_protocol::domain::connection`'s
        // docs). So the events loop below, not this task, is the
        // authoritative "connection is done" signal.
        let mut rx = acp.rx;
        let acp_service = Arc::clone(&self.service);
        let acp_task = tokio::spawn(async move {
            while let Some(next) = rx.next().await {
                match next {
                    Ok(message) => {
                        let _ = acp_service
                            .handle_agent_message(session_id, message)
                            .await
                            .inspect_err(
                                |e| tracing::error!(error=?e, %session_id, "agent message failed"),
                            );
                    }
                    Err(e) => {
                        tracing::error!(error=?e, %session_id, "ACP channel error");
                    }
                }
            }
        });

        while let Some(event) = event_rx.recv().await {
            let _ = self
                .service
                .handle_system_event(session_id, event)
                .await
                .inspect_err(|e| tracing::error!(error=?e, %session_id, "system event failed"));
        }
        acp_task.abort();

        // `connection` is kept alive for the whole connection's lifetime -
        // dropping it earlier would stop its driver task and close both
        // channels out from under the loops above.
        drop(connection);

        if self.attachments.unregister(session_id, registration) {
            self.service.handle_agent_detached(session_id);
        }
        tracing::info!(%session_id, epoch, "agent runtime disconnected");
    }
}
