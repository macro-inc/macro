//! Agent runtime connection driver.
//!
//! `agent_runtime_protocol` hosts exactly one agent execution per physical
//! connection and carries no session identifier on the wire. Correlating an
//! accepted
//! connection to a chat/session id is therefore established out of band, by
//! the adapter that accepts the connection:
//! [`crate::outbound::shared_runtime_connections::SharedRuntimeConnections`]
//! matches an `?id=` query parameter on its one shared WebSocket endpoint and
//! hands `(session_id, channel)` to the composition root over a plain
//! channel. [`RuntimeConnectionDriver::run`] drains that channel and drives
//! each connection into the domain service.

use crate::domain::ports::SessionAttachments;
use crate::domain::service::AgentProxyService;
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
/// Each connection already arrives tagged with the session it belongs to
/// (matched against the `?id=` query parameter by
/// [`crate::outbound::shared_runtime_connections::SharedRuntimeConnections`]),
/// so there is no routing table here beyond that tag: one accepted connection
/// drives exactly one session.
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

    /// Drain accepted `(session_id, channel)` pairs, spawning an independent
    /// task to drive each one so a slow or long-lived session never blocks
    /// another session's connection from being accepted and driven.
    pub async fn run(self: Arc<Self>, mut incoming: UnboundedReceiver<(Uuid, ServerChannel)>) {
        while let Some((session_id, channel)) = incoming.recv().await {
            let driver = Arc::clone(&self);
            tokio::spawn(async move { driver.drive(session_id, channel).await });
        }
        tracing::info!("runtime connection source closed; driver stopping");
    }

    /// Attach one accepted connection's ACP channel to `session_id`, pump its
    /// traffic into the domain service, and clean up when it closes.
    async fn drive(&self, session_id: Uuid, channel: ServerChannel) {
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

        // The runtime's hosted agent process may not exist yet when the
        // connection is accepted (e.g. its sandbox is still booting): the
        // handshake can't start until the runtime reports readiness over the
        // system-event channel, so wait for `SystemEvent::AcpReady` rather
        // than firing `initialize` blind. Bootstrap at most once per
        // connection even if the event somehow arrives more than once.
        let mut acp_bootstrap_started = false;

        while let Some(event) = event_rx.recv().await {
            if !acp_bootstrap_started && event == SystemEvent::AcpReady {
                acp_bootstrap_started = true;
                // Spawned rather than awaited inline: it depends on
                // `acp_task` above (already running) to observe the
                // `session/new` response, and must not hold up this
                // system-event loop.
                let service = Arc::clone(&self.service);
                tokio::spawn(async move {
                    let _ = service
                        .handle_agent_connected(session_id)
                        .await
                        .inspect_err(
                            |e| tracing::error!(error=?e, %session_id, "failed to start ACP session"),
                        );
                });
            }

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
