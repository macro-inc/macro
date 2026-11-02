//! The router core: one task owns this, so per-connection ordering is
//! enforced by construction and no state needs locks.

#[cfg(test)]
mod test;

use crate::domain::{
    envelope::{self, ClientEnvelope},
    models::{ConnectionId, DocId, DownstreamFailure, EdgeEvent, Event},
    ports::{Downstream, DownstreamFactory, EdgeSink},
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

/// Routes envelope frames between client connections and per-document
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
    sender: Downstream,
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
    pub async fn run(mut self, mut events: mpsc::Receiver<Event>, cancel: CancellationToken) {
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                event = events.recv() => match event {
                    Some(event) => self.handle(event).await,
                    None => break,
                },
            }
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
            Event::DownstreamClosed {
                conn,
                doc,
                epoch,
                failure,
            } => {
                // Teardown and notification are atomic with respect to retries.
                // A stale pump cannot affect a replacement route or virtual socket.
                let is_current = self
                    .routes
                    .get(&(conn.clone(), doc.clone()))
                    .is_some_and(|route| route.epoch == epoch);
                if is_current {
                    self.forget(&conn, &doc);
                    let frame = match failure {
                        DownstreamFailure::DialFailed => {
                            envelope::subscribe_failed(doc.as_str(), "dial failed")
                        }
                        DownstreamFailure::Closed(reason) => {
                            envelope::doc_closed(doc.as_str(), reason)
                        }
                    };
                    self.deliver(&conn, frame).await;
                }
            }
        }
    }

    #[tracing::instrument(skip_all, fields(conn = %conn.0))]
    async fn handle_client(&mut self, conn: ConnectionId, frame: ClientEnvelope) {
        match frame {
            ClientEnvelope::RouterSubscribe { doc_id, token } => {
                if doc_id.len() > 512 || token.len() > 16 * 1024 {
                    self.deliver(
                        &conn,
                        envelope::subscribe_failed(&doc_id, "invalid subscription"),
                    )
                    .await;
                    return;
                }
                let doc = DocId(doc_id);
                let key = (conn.clone(), doc.clone());
                if self.routes.contains_key(&key) {
                    // Retry with fresh authority, cancelling the previous incarnation.
                    // The old pump may have sent its failure before its cleanup event
                    // reached us. Never acknowledge a still-pending handshake.
                    self.forget(&conn, &doc);
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
            ClientEnvelope::RouterUnsubscribe { doc_id } => {
                // Dropping the sender closes the downstream quietly (the pump
                // distinguishes our hangup from an upstream death).
                self.forget(&conn, &DocId(doc_id));
            }
            // decode_client rejects Unknown before we get here.
            ClientEnvelope::Unknown => {}
            ClientEnvelope::RouterFrame { doc_id, payload } => {
                let doc = DocId(doc_id);
                let Some(sender) = self.routes.get(&(conn.clone(), doc.clone())) else {
                    warn!(
                        doc = doc.as_str(),
                        "frame for unsubscribed document; dropping"
                    );
                    return;
                };
                // Losing a chunk can corrupt the inner framing stream. Tear
                // down this route so the client reconnects and resynchronizes.
                if let Err(error) = sender.sender.try_send(payload) {
                    warn!(doc = doc.as_str(), error = %error, "downstream queue unavailable; closing route");
                    self.forget(&conn, &doc);
                    self.deliver(
                        &conn,
                        envelope::doc_closed(doc.as_str(), "downstream queue unavailable"),
                    )
                    .await;
                }
            }
        }
    }

    fn drop_conn(&mut self, conn: &ConnectionId) {
        let Some(docs) = self.by_conn.remove(conn) else {
            return;
        };
        debug!(conn = %conn.0, count = docs.len(), "dropping connection's downstreams");
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
                warn!(error = ?error, conn = %conn.0, "failed to deliver frame to client");
            })
            .ok();
    }
}
