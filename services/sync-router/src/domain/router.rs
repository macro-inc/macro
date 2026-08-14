//! The router core: one task owns this, so per-connection ordering is
//! enforced by construction and no state needs locks.

#[cfg(test)]
mod test;

use crate::domain::{
    envelope::{self, ClientEnvelope},
    models::{ConnectionId, DocId, EdgeEvent, Event},
    ports::{DownstreamFactory, EdgeSink},
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Routes envelope frames between gateway connections and per-document
/// downstreams. Owned and driven by a single task; see [`Router::handle`].
pub struct Router<Sink: EdgeSink, Downstreams: DownstreamFactory> {
    sink: Arc<Sink>,
    downstreams: Downstreams,
    routes: HashMap<(ConnectionId, DocId), Route>,
    /// Which documents each connection has open, for disconnect teardown.
    by_conn: HashMap<ConnectionId, HashSet<DocId>>,
    /// Monotonic route-incarnation counter; see [`Event::DownstreamClosed`].
    next_epoch: u64,
}

/// One live (or dialing) downstream route.
struct Route {
    epoch: u64,
    sender: mpsc::Sender<Vec<u8>>,
}

/// Documents one connection may hold open at once. The downstream token is
/// only validated after the dial, so this bounds how much outbound work an
/// authenticated-but-unauthorized client can trigger.
const MAX_DOCS_PER_CONN: usize = 64;

impl<Sink: EdgeSink, Downstreams: DownstreamFactory> Router<Sink, Downstreams> {
    /// Create a router over the given sink and downstream factory.
    pub fn new(sink: Arc<Sink>, downstreams: Downstreams) -> Self {
        Self {
            sink,
            downstreams,
            routes: HashMap::new(),
            by_conn: HashMap::new(),
            next_epoch: 0,
        }
    }

    /// Drive the router from an event stream until it closes.
    pub async fn run(mut self, mut events: mpsc::Receiver<Event>) {
        while let Some(event) = events.recv().await {
            self.handle(event).await;
        }
    }

    /// Process one event.
    #[tracing::instrument(skip_all)]
    pub async fn handle(&mut self, event: Event) {
        match event {
            Event::Edge(EdgeEvent::Frame { conn, payload }) => {
                match envelope::decode_client(&payload) {
                    Ok(frame) => self.handle_client(conn, frame).await,
                    Err(error) => {
                        warn!(error = ?error, conn = ?conn, "dropping undecodable client frame");
                    }
                }
            }
            Event::Edge(EdgeEvent::Disconnected { conn }) => self.drop_conn(&conn),
            Event::Edge(EdgeEvent::GatewayLost { gateway }) => {
                let conns: Vec<ConnectionId> = self
                    .by_conn
                    .keys()
                    .filter(|conn| conn.gateway == gateway)
                    .cloned()
                    .collect();
                debug!(
                    gateway = %gateway,
                    count = conns.len(),
                    "gateway lost; dropping its connections"
                );
                for conn in conns {
                    self.drop_conn(&conn);
                }
            }
            Event::DownstreamClosed { conn, doc, epoch } => {
                // The pump already told the client; forget the route — but
                // only if it is still the incarnation that died. A stale
                // close must not tear down a replacement route.
                let is_current = self
                    .routes
                    .get(&(conn.clone(), doc.clone()))
                    .is_some_and(|route| route.epoch == epoch);
                if is_current {
                    self.forget(&conn, &doc);
                }
            }
        }
    }

    #[tracing::instrument(skip_all, fields(conn = %conn.conn, gateway = %conn.gateway))]
    async fn handle_client(&mut self, conn: ConnectionId, frame: ClientEnvelope) {
        match frame {
            ClientEnvelope::Subscribe { doc, token } => {
                let doc = DocId(doc);
                let key = (conn.clone(), doc.clone());
                if self.routes.contains_key(&key) {
                    // Idempotent: the downstream is already up (or dialing).
                    // Re-ack so a retrying client settles.
                    self.deliver(&conn, envelope::subscribed(doc.as_str()))
                        .await;
                    return;
                }
                if self
                    .by_conn
                    .get(&conn)
                    .is_some_and(|docs| docs.len() >= MAX_DOCS_PER_CONN)
                {
                    warn!(doc = doc.as_str(), "per-connection document cap reached");
                    self.deliver(
                        &conn,
                        envelope::subscribe_failed(doc.as_str(), "too many open documents"),
                    )
                    .await;
                    return;
                }
                debug!(doc = doc.as_str(), "opening downstream");
                self.next_epoch += 1;
                let epoch = self.next_epoch;
                let sender = self
                    .downstreams
                    .open(conn.clone(), doc.clone(), token, epoch);
                self.routes.insert(key, Route { epoch, sender });
                self.by_conn.entry(conn).or_default().insert(doc);
            }
            ClientEnvelope::Unsubscribe { doc } => {
                // Dropping the sender closes the downstream quietly (the pump
                // distinguishes our hangup from an upstream death).
                self.forget(&conn, &DocId(doc));
            }
            ClientEnvelope::Frame { doc, payload } => {
                let doc = DocId(doc);
                let Some(sender) = self.routes.get(&(conn.clone(), doc.clone())) else {
                    warn!(
                        doc = doc.as_str(),
                        "frame for unsubscribed document; dropping"
                    );
                    return;
                };
                // try_send: a full buffer means a downstream that can't keep
                // up; drop the frame — the sync protocol self-heals via
                // catch-up requests. A closed channel means the downstream
                // died; DownstreamClosed will clean the route up.
                if let Err(error) = sender.sender.try_send(payload) {
                    warn!(doc = doc.as_str(), error = %error, "dropping frame for downstream");
                }
            }
        }
    }

    fn drop_conn(&mut self, conn: &ConnectionId) {
        let Some(docs) = self.by_conn.remove(conn) else {
            return;
        };
        debug!(conn = %conn.conn, count = docs.len(), "dropping connection's downstreams");
        for doc in docs {
            self.routes.remove(&(conn.clone(), doc));
        }
    }

    /// Remove one route and its `by_conn` entry (and the set itself once empty).
    fn forget(&mut self, conn: &ConnectionId, doc: &DocId) {
        self.routes.remove(&(conn.clone(), doc.clone()));
        if let Some(docs) = self.by_conn.get_mut(conn) {
            docs.remove(doc);
            if docs.is_empty() {
                self.by_conn.remove(conn);
            }
        }
    }

    async fn deliver(&self, conn: &ConnectionId, frame: Vec<u8>) {
        self.sink
            .deliver(conn, frame)
            .await
            .map_err(Into::into)
            .inspect_err(|error: &anyhow::Error| {
                warn!(error = ?error, conn = %conn.conn, "failed to deliver frame to client");
            })
            .ok();
    }
}
