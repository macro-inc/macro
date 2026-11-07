//! Per-WebSocket sync routing. No shared subscription or cross-replica relay.

use crate::{
    domain::{
        models::{ConnectionId, EdgeEvent, Event},
        ports::EdgeSink,
        router::Router,
    },
    outbound::do_downstream::DoDownstreamFactory,
};
use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::{
    sync::{CancellationToken, DropGuard},
    task::{TaskTracker, task_tracker::TaskTrackerToken},
};
use tracing::Instrument;
use url::Url;

#[cfg(test)]
mod test;

const ROUTER_QUEUE_CAPACITY: usize = 8;

/// Routing resources owned by one authenticated client WebSocket.
pub struct SyncSession {
    _active: TaskTrackerToken,
    connection: ConnectionId,
    events: mpsc::Sender<Event>,
    cancel: CancellationToken,
    tasks: TaskTracker,
    _cancel_on_drop: DropGuard,
}

impl SyncSession {
    /// Start a router that can deliver only to this socket's bounded queue.
    fn new(
        connection_id: String,
        base_url: Url,
        sender: mpsc::Sender<Vec<u8>>,
        parent: &SyncSessionFactory,
    ) -> Self {
        let connection = ConnectionId(connection_id);
        let cancel = parent.cancel.child_token();
        let tasks = TaskTracker::new();
        let (events, receiver) = mpsc::channel(ROUTER_QUEUE_CAPACITY);
        let sink = Arc::new(SocketSink {
            connection: connection.clone(),
            sender,
            cancel: cancel.clone(),
        });
        let downstreams = DoDownstreamFactory::new(
            base_url,
            Arc::clone(&sink),
            events.clone(),
            cancel.clone(),
            tasks.clone(),
        );
        let router = Router::new(sink, downstreams);
        tasks.spawn(router.run(receiver, cancel.clone()).in_current_span());
        Self {
            _active: parent.active.token(),
            connection,
            events,
            _cancel_on_drop: cancel.clone().drop_guard(),
            cancel,
            tasks,
        }
    }

    /// Apply backpressure only to this connection, preserving binary frame order.
    pub async fn frame(&self, payload: Vec<u8>) -> Result<()> {
        anyhow::ensure!(payload.len() <= MAX_FRAME_BYTES, "sync frame too large");
        self.events
            .send(Event::Edge(EdgeEvent::Frame {
                conn: self.connection.clone(),
                payload,
            }))
            .await
            .context("sync router stopped")
    }

    /// Stop the socket if routing fails or its outbound queue stops draining.
    pub async fn closed(&self) {
        tokio::select! {
            _ = self.cancel.cancelled() => {},
            _ = self.events.closed() => {},
        }
    }

    /// Cancel dialing and established downstreams, then join every routing task.
    pub async fn shutdown(self) {
        self.cancel.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }
}

struct SocketSink {
    connection: ConnectionId,
    sender: mpsc::Sender<Vec<u8>>,
    cancel: CancellationToken,
}

impl EdgeSink for SocketSink {
    type Err = anyhow::Error;

    #[tracing::instrument(skip_all, fields(connection.id = %conn.0), err)]
    async fn deliver(&self, conn: &ConnectionId, frame: Vec<u8>) -> Result<()> {
        anyhow::ensure!(
            conn == &self.connection,
            "sync frame targets another connection"
        );
        if frame.len() > MAX_FRAME_BYTES {
            self.cancel.cancel();
            anyhow::bail!("sync response too large");
        }
        if self.sender.try_send(frame).is_err() {
            // Dropping a chunk corrupts framing. Close this socket so its virtual
            // sockets reconnect and resync instead of losing a partial message.
            self.cancel.cancel();
            anyhow::bail!("sync client outbound queue is full or closed");
        }
        Ok(())
    }
}

/// Maximum outer message size; inner sync chunks are at most 900,001 bytes.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// The bounded client queue also caps queued response bytes at eight MiB.
pub const CLIENT_QUEUE_CAPACITY: usize = 8;

/// Composition root shared by the host's sockets, including process shutdown.
#[derive(Clone)]
pub struct SyncSessionFactory {
    base_url: Url,
    cancel: CancellationToken,
    active: TaskTracker,
}

impl SyncSessionFactory {
    /// Validate the upstream origin once at service startup.
    pub fn new(base_url: Url) -> Result<Self> {
        anyhow::ensure!(
            matches!(base_url.scheme(), "http" | "https")
                && base_url.has_host()
                && base_url.path() == "/"
                && base_url.query().is_none()
                && base_url.fragment().is_none()
                && base_url.username().is_empty()
                && base_url.password().is_none(),
            "sync service URL must be an HTTP(S) origin",
        );
        Ok(Self {
            base_url,
            cancel: CancellationToken::new(),
            active: TaskTracker::new(),
        })
    }

    /// Each socket gets independent routes, cancellation, and bounded queues.
    pub fn open(&self, connection_id: String, sender: mpsc::Sender<Vec<u8>>) -> SyncSession {
        SyncSession::new(connection_id, self.base_url.clone(), sender, self)
    }

    /// Begin draining while the HTTP host stops accepting new connections.
    pub fn cancel(&self) {
        self.cancel.cancel();
        self.active.close();
    }

    /// Drain every upgraded socket and downstream before the host exits.
    pub async fn shutdown(&self) {
        self.cancel();
        self.active.wait().await;
    }
}
