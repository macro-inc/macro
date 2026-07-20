//! Ephemeral per-session runtime listeners implementing the
//! [`RuntimeProvisioner`] port.

use crate::domain::ports::RuntimeProvisioner;
use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::ServerTransport;
use anyhow::Context;
use macro_uuid::Uuid;
use std::ops::RangeInclusive;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::oneshot;

/// Keeps an ephemeral listener alive for as long as its accepted connection
/// is in use.
///
/// Sending on (or dropping) the held sender resolves the server task's
/// graceful-shutdown future, which stops accepting new connections but lets
/// the one already accepted keep running - so the listener must outlive the
/// connection it accepted, rather than being torn down the moment `accept()`
/// resolves. Dropping this guard (once the connection is actually done) is
/// what reclaims the listener.
pub struct ConnectionGuard(#[allow(dead_code)] oneshot::Sender<()>);

/// Binds a fresh, single-use WebSocket listener per session so that whatever
/// connection it accepts is unambiguously that session's runtime, then hands
/// the connection off on `incoming` for the composition root to drive.
///
/// Listeners bind within a fixed port range rather than an OS-assigned port:
/// an OS-assigned port has no fixed mapping out of a container (or through
/// any other static port-forwarding boundary between this service and
/// whatever launches runtimes), so it's unreachable from outside. The range
/// must be pre-published wherever this service runs (e.g.
/// `docker/docker-compose.yml`'s `agent_proxy_service` port list).
pub struct EphemeralRuntimeConnections {
    /// Host clients should use to dial back in (the listener itself always
    /// binds every interface; only the advertised host varies per
    /// deployment).
    advertise_host: String,
    port_range: RangeInclusive<u16>,
    next_offset: AtomicU32,
    incoming: UnboundedSender<(Uuid, ServerChannel, ConnectionGuard)>,
}

impl EphemeralRuntimeConnections {
    /// Create the adapter. Accepted connections are sent on `incoming`; the
    /// composition root is expected to drain it (e.g. via
    /// `crate::inbound::runtime::RuntimeConnectionDriver::run`), holding the
    /// [`ConnectionGuard`] alive for as long as it drives the connection.
    pub fn new(
        advertise_host: String,
        port_range: RangeInclusive<u16>,
        incoming: UnboundedSender<(Uuid, ServerChannel, ConnectionGuard)>,
    ) -> Self {
        Self {
            advertise_host,
            port_range,
            next_offset: AtomicU32::new(0),
            incoming,
        }
    }

    /// Bind the next available port in the range, round-robining the
    /// starting point across calls so a run of failed (in-use) attempts
    /// doesn't always retry the same low end of the range first.
    async fn bind_in_range(&self) -> anyhow::Result<(TcpListener, u16)> {
        let start = u32::from(*self.port_range.start());
        let span = u32::from(*self.port_range.end()) - start + 1;

        for attempt in 0..span {
            let offset = (self.next_offset.fetch_add(1, Ordering::Relaxed) + attempt) % span;
            let port = (start + offset) as u16;
            if let Ok(listener) = TcpListener::bind(format!("0.0.0.0:{port}")).await {
                return Ok((listener, port));
            }
        }

        anyhow::bail!(
            "no free port available in {}-{} for an ephemeral runtime listener",
            self.port_range.start(),
            self.port_range.end()
        )
    }
}

impl RuntimeProvisioner for EphemeralRuntimeConnections {
    #[tracing::instrument(err, skip(self))]
    async fn provision(&self, session_id: Uuid) -> anyhow::Result<String> {
        let transport = Arc::new(ServerTransport::<ToRuntimeMessage, ToServerMessage>::new());
        let (listener, port) = self
            .bind_in_range()
            .await
            .context("failed to bind ephemeral runtime listener")?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let router = transport.clone().into_router();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        let incoming = self.incoming.clone();
        tokio::spawn(async move {
            if let Some(channel) = transport.accept().await {
                let _ = incoming.send((session_id, channel, ConnectionGuard(shutdown_tx)));
            }
            // No runtime ever dialed in: `shutdown_tx` (never handed off
            // above) drops here, resolving the graceful-shutdown future and
            // reclaiming the listener. Otherwise the guard travels with the
            // channel and reclaims it once the driven connection is
            // actually done.
        });

        Ok(format!("ws://{}:{}", self.advertise_host, port))
    }
}
