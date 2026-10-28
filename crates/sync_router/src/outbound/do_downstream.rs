//! [`DownstreamFactory`] that dials the Cloudflare Durable Object
//! sync-service, one websocket per `(connection, document)` — the DO sees
//! each client as an ordinary peer, so nothing changes on the Cloudflare side.
//!
//! Chapter 2 replaces this with a factory that consistent-hashes the document
//! id across native sync services; the router core is unaware.

use crate::domain::envelope;
use crate::domain::models::{ConnectionId, DocId, DownstreamFailure, Event};
use crate::domain::ports::{Downstream, DownstreamFactory, EdgeSink, QueuedFrame};
use futures::{SinkExt, StreamExt};
use opentelemetry::trace::TraceContextExt;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Semaphore, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async_with_config, tungstenite::protocol::WebSocketConfig};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::{Instrument, debug, warn};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use url::Url;

/// How many client frames may buffer while the dial is in flight (or the
/// upstream is slow). Overflow closes the route so the client resynchronizes.
const DOWNSTREAM_BUFFER: usize = 8;
/// Shared by every document queue and in-flight upstream write in a session.
const DOWNSTREAM_BYTE_BUDGET: usize = 8 * 1024 * 1024;

/// Keep the upstream (and its Durable Object) alive, mirroring the ping the
/// browser used to send on its direct per-document socket.
const UPSTREAM_PING_INTERVAL: Duration = Duration::from_secs(30);

/// Dials `{base_url}/document/{doc}/connect?token=…&traceparent=…`.
pub struct DoDownstreamFactory<Sink: EdgeSink> {
    base_url: Url,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
    cancel: CancellationToken,
    tasks: TaskTracker,
    budget: Arc<Semaphore>,
}

impl<Sink: EdgeSink> DoDownstreamFactory<Sink> {
    /// `base_url` is the sync-service origin, e.g. `http://localhost:8787`.
    pub fn new(
        base_url: Url,
        sink: Arc<Sink>,
        events: mpsc::Sender<Event>,
        cancel: CancellationToken,
        tasks: TaskTracker,
    ) -> Self {
        Self {
            budget: Arc::new(Semaphore::new(DOWNSTREAM_BYTE_BUDGET)),
            base_url,
            sink,
            events,
            cancel,
            tasks,
        }
    }
}

impl<Sink: EdgeSink> DownstreamFactory for DoDownstreamFactory<Sink> {
    #[tracing::instrument(skip(self, token), fields(document.id = doc.as_str()))]
    fn open(&self, conn: ConnectionId, doc: DocId, token: String, epoch: u64) -> Downstream {
        let (sender, receiver) = mpsc::channel(DOWNSTREAM_BUFFER);

        let mut url = self.base_url.clone();
        // The composition root validates the base; URL APIs encode document ids
        // and scoped tokens so neither can change the downstream destination.
        let scheme = if url.scheme() == "http" { "ws" } else { "wss" };
        url.set_scheme(scheme)
            .expect("HTTP sync origin accepts a WebSocket scheme");
        url.path_segments_mut()
            .expect("sync origin is a base URL")
            .pop_if_empty()
            .extend(["document", doc.as_str(), "connect"]);
        url.query_pairs_mut().clear().append_pair("token", &token);
        if let Some(traceparent) = current_traceparent() {
            url.query_pairs_mut()
                .append_pair("traceparent", &traceparent);
        }

        let cancel = self.cancel.child_token();
        let pump_cancel = cancel.clone();
        let sink = Arc::clone(&self.sink);
        let events = self.events.clone();
        self.tasks.spawn(
            async move {
                tokio::select! {
                    biased;
                    _ = pump_cancel.cancelled() => {},
                    _ = pump(url.to_string(), conn, doc, epoch, receiver, sink, events) => {},
                }
            }
            .in_current_span(),
        );
        Downstream::new(sender, cancel, self.budget.clone())
    }
}

/// The whole life of one downstream connection: dial, then pump frames both
/// ways until either side hangs up.
#[tracing::instrument(skip_all, fields(document.id = doc.as_str(), conn = %conn.0))]
async fn pump<Sink: EdgeSink>(
    url: String,
    conn: ConnectionId,
    doc: DocId,
    epoch: u64,
    mut from_client: mpsc::Receiver<QueuedFrame>,
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

    let upstream = match tokio::time::timeout(
        Duration::from_secs(10),
        connect_async_with_config(
            &url,
            Some(
                WebSocketConfig::default()
                    .max_message_size(Some(crate::session::MAX_FRAME_BYTES - 1024))
                    .max_frame_size(Some(crate::session::MAX_FRAME_BYTES - 1024)),
            ),
            false,
        ),
    )
    .await
    {
        Ok(Ok((upstream, _response))) => upstream,
        failure => {
            warn!(timed_out = failure.is_err(), "downstream dial failed");
            events
                .send(Event::DownstreamClosed {
                    conn,
                    doc,
                    epoch,
                    failure: DownstreamFailure::DialFailed,
                })
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
                Some(frame) => {
                    if let Err(error) = write.send(Message::Binary(frame.bytes.into())).await {
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
            events
                .send(Event::DownstreamClosed {
                    conn,
                    doc,
                    epoch,
                    failure: DownstreamFailure::Closed(reason),
                })
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
