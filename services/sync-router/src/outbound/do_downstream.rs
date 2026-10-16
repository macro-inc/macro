//! [`DownstreamFactory`] that dials the Cloudflare Durable Object
//! sync-service, one websocket per `(connection, document)` — the DO sees
//! each client as an ordinary peer, so nothing changes on the Cloudflare side.
//!
//! Chapter 2 replaces this with a factory that consistent-hashes the document
//! id across native sync services; the router core is unaware.

use crate::domain::envelope;
use crate::domain::models::{ConnectionId, DocId, Event};
use crate::domain::ports::{DownstreamFactory, EdgeSink};
use futures::{SinkExt, StreamExt};
use opentelemetry::trace::TraceContextExt;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// How many client frames may buffer while the dial is in flight (or the
/// upstream is slow). Overflow drops frames; the sync protocol self-heals.
const DOWNSTREAM_BUFFER: usize = 256;

/// Keep the upstream (and its Durable Object) alive, mirroring the ping the
/// browser used to send on its direct per-document socket.
const UPSTREAM_PING_INTERVAL: Duration = Duration::from_secs(30);

/// Dials `{base_url}/document/{doc}/connect?token=…&traceparent=…`.
pub struct DoDownstreamFactory<Sink: EdgeSink> {
    base_url: String,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
}

impl<Sink: EdgeSink> DoDownstreamFactory<Sink> {
    /// `base_url` is the sync-service origin, e.g. `http://localhost:8787`.
    pub fn new(base_url: String, sink: Arc<Sink>, events: mpsc::Sender<Event>) -> Self {
        Self {
            base_url,
            sink,
            events,
        }
    }
}

impl<Sink: EdgeSink> DownstreamFactory for DoDownstreamFactory<Sink> {
    #[tracing::instrument(skip(self, token), fields(document.id = doc.as_str()))]
    fn open(
        &self,
        conn: ConnectionId,
        doc: DocId,
        token: String,
        epoch: u64,
    ) -> mpsc::Sender<Vec<u8>> {
        let (sender, receiver) = mpsc::channel(DOWNSTREAM_BUFFER);

        let ws_base = self
            .base_url
            .replacen("http://", "ws://", 1)
            .replacen("https://", "wss://", 1);
        let mut url = format!("{ws_base}/document/{}/connect?token={token}", doc.as_str());
        // The DO reads `traceparent` from the query string (browser websocket
        // upgrades can't carry headers, so the DO accepts it there; we use the
        // same mechanism).
        if let Some(traceparent) = current_traceparent() {
            url.push_str(&format!("&traceparent={traceparent}"));
        }

        tokio::spawn(pump(
            url,
            conn,
            doc,
            epoch,
            receiver,
            Arc::clone(&self.sink),
            self.events.clone(),
        ));
        sender
    }
}

/// The whole life of one downstream connection: dial, then pump frames both
/// ways until either side hangs up.
#[tracing::instrument(skip_all, fields(document.id = doc.as_str(), conn = %conn.conn))]
async fn pump<Sink: EdgeSink>(
    url: String,
    conn: ConnectionId,
    doc: DocId,
    epoch: u64,
    mut from_client: mpsc::Receiver<Vec<u8>>,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
) {
    let deliver = |frame: Vec<u8>| {
        let sink = Arc::clone(&sink);
        let conn = conn.clone();
        async move {
            sink.deliver(&conn, frame)
                .await
                .map_err(Into::into)
                .inspect_err(|error: &anyhow::Error| {
                    warn!(error = ?error, "failed to deliver to client");
                })
                .ok();
        }
    };

    let upstream = match connect_async(&url).await {
        Ok((upstream, _response)) => upstream,
        Err(error) => {
            warn!(error = ?error, "downstream dial failed");
            deliver(envelope::subscribe_failed(doc.as_str(), "dial failed")).await;
            events
                .send(Event::DownstreamClosed { conn, doc, epoch })
                .await
                .ok();
            return;
        }
    };
    debug!("downstream connected");
    deliver(envelope::subscribed(doc.as_str())).await;

    let (mut write, mut read) = upstream.split();
    let mut ping = tokio::time::interval(UPSTREAM_PING_INTERVAL);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // `None` = the router dropped our sender (unsubscribe / client
    // disconnect): close quietly. `Some(reason)` = the upstream went away:
    // tell the client (a coarse reason only — raw errors can leak internals)
    // so it can re-subscribe.
    let closed_reason: Option<&str> = loop {
        tokio::select! {
            frame = from_client.recv() => match frame {
                Some(bytes) => {
                    if let Err(error) = write.send(Message::Binary(bytes.into())).await {
                        warn!(error = ?error, "upstream write failed");
                        break Some("upstream write failed");
                    }
                }
                None => break None,
            },
            incoming = read.next() => match incoming {
                Some(Ok(Message::Binary(bytes))) => {
                    deliver(envelope::doc_frame(doc.as_str(), &bytes)).await;
                }
                // The DO's "pong" heartbeat replies (and any other text).
                Some(Ok(Message::Text(_))) => {}
                Some(Ok(Message::Close(_))) | None => break Some("upstream closed"),
                Some(Ok(_)) => {}
                Some(Err(error)) => {
                    warn!(error = ?error, "upstream read failed");
                    break Some("upstream error");
                }
            },
            _ = ping.tick() => {
                if let Err(error) = write.send(Message::Text("ping".into())).await {
                    warn!(error = ?error, "upstream ping failed");
                    break Some("upstream ping failed");
                }
            }
        }
    };

    match closed_reason {
        Some(reason) => {
            debug!(reason, "downstream closed");
            deliver(envelope::doc_closed(doc.as_str(), reason)).await;
            events
                .send(Event::DownstreamClosed { conn, doc, epoch })
                .await
                .ok();
        }
        None => {
            debug!("router hung up; closing downstream");
            write.send(Message::Close(None)).await.ok();
        }
    }
}

/// The current span's context as a W3C traceparent, if a trace is recording.
fn current_traceparent() -> Option<String> {
    let context = tracing::Span::current().context();
    let span = context.span();
    let span_context = span.span_context();
    span_context.is_valid().then(|| {
        format!(
            "00-{}-{}-{:02x}",
            span_context.trace_id(),
            span_context.span_id(),
            span_context.trace_flags().to_u8(),
        )
    })
}
