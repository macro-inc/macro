//! Plain WebSocket carrier.
//!
//! Both peers of the WebSocket are symmetric: either side can push a logical
//! message onto the wire the instant the socket exists, and the other side
//! just reads it. There is no RPC session, no method dispatch, no request id,
//! and no subscribe/unsubscribe handshake to establish first - a WebSocket
//! frame is not itself JSON-RPC, unlike the ACP payload it can carry.
//!
//! One WebSocket text frame carries exactly one complete logical message -
//! [`crate::domain::schema::v0::ToRuntimeMessage`] or
//! [`crate::domain::schema::v0::ToServerMessage`], `"type"`-tagged as
//! described in [`crate::domain::schema`]:
//!
//! ```json
//! { "type": "event", "event": "agent/stopped" }
//! ```

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message as AxumMessage, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;
use futures::{Sink, SinkExt, Stream, StreamExt};
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::mpsc;
// Tokio's clock rather than the standard library's, so the silence deadline is
// on the same clock as the interval that checks it - and so a test can drive
// both without waiting out six real seconds.
use tokio::time::Instant;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

use crate::domain::channel::{Channel, pump};
use crate::domain::ports::{Transport, TransportError, TransportSender};

#[cfg(test)]
mod test;

/// How often each peer sends a WebSocket ping.
///
/// Both ends ping on their own timer rather than one pinging and the other
/// answering. Keepalive would only need one side - any frame resets an idle
/// proxy's timer - but *detection* is per-endpoint: the gateway has to notice
/// a daemon that went away, and a daemon has to notice a gateway that did, so
/// each end needs traffic it can time out on. Symmetric also means neither
/// end depends on the other being new enough to ping.
const PING_INTERVAL: Duration = Duration::from_secs(2);

/// How long a socket may go without any inbound frame before this side
/// declares it dead.
///
/// Three missed pings. A live peer answers every ping with a pong, and a pong
/// is an inbound frame, so silence this long means the peer is gone or the
/// path to it is - the case a half-open socket produces, where writes keep
/// succeeding into a connection that will never answer again.
const SILENCE_TIMEOUT: Duration = Duration::from_secs(6);

/// A physical WebSocket frame type: one JSON text payload, or a ping.
///
/// Implemented for both `axum`'s and `tokio-tungstenite`'s message types so
/// the pump loop below can drive either a server-accepted or a
/// client-dialed socket without caring which library it came from.
trait WireFrame: Sized {
    /// Wrap a JSON payload as a text frame.
    fn text(payload: String) -> Self;

    /// An empty ping frame.
    fn ping() -> Self;

    /// Extract this frame's text payload, if it has one.
    ///
    /// Non-text frames (ping/pong/binary/close) are not part of the logical
    /// protocol and are silently skipped by the pump loop - but they still
    /// count as liveness, which is the whole point of the pings.
    fn into_text(self) -> Option<String>;
}

impl WireFrame for AxumMessage {
    fn text(payload: String) -> Self {
        Self::Text(payload.into())
    }

    fn ping() -> Self {
        Self::Ping(Default::default())
    }

    fn into_text(self) -> Option<String> {
        match self {
            Self::Text(text) => Some(text.to_string()),
            _ => None,
        }
    }
}

impl WireFrame for TungsteniteMessage {
    fn text(payload: String) -> Self {
        Self::Text(payload.into())
    }

    fn ping() -> Self {
        Self::Ping(Default::default())
    }

    fn into_text(self) -> Option<String> {
        match self {
            Self::Text(text) => Some(text.to_string()),
            _ => None,
        }
    }
}

/// Drive one physical WebSocket until it closes or fails: outgoing JSON text
/// pulled from `outgoing` is written to the socket, and incoming text frames
/// are decoded and pushed onto `incoming`.
///
/// A frame that fails to decode as `Rx` is dropped with a warning rather than
/// closing the connection - the rest of the logical stream is unaffected by
/// one malformed message.
async fn run_pump<Rx, Socket, Frame, Error>(
    socket: Socket,
    mut outgoing: mpsc::UnboundedReceiver<String>,
    incoming: mpsc::UnboundedSender<Rx>,
) where
    Rx: DeserializeOwned,
    Frame: WireFrame,
    Socket: Sink<Frame, Error = Error> + Stream<Item = Result<Frame, Error>> + Unpin,
{
    let (mut sink, mut stream) = socket.split();
    let mut ping = tokio::time::interval(PING_INTERVAL);
    // A pump that was busy longer than one tick owes one ping, not a burst of
    // however many it slept through.
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_inbound = Instant::now();
    loop {
        tokio::select! {
            next_outgoing = outgoing.recv() => {
                let Some(payload) = next_outgoing else { break };
                if sink.send(Frame::text(payload)).await.is_err() {
                    break;
                }
            }
            next_incoming = stream.next() => {
                // Every frame counts, text or not: a pong carries no logical
                // message and is exactly what proves the peer is still there.
                last_inbound = Instant::now();
                match next_incoming {
                    Some(Ok(frame)) => {
                        let Some(text) = frame.into_text() else { continue };
                        match serde_json::from_str::<Rx>(&text) {
                            Ok(message) => {
                                if incoming.send(message).is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                tracing::warn!(error = ?error, "dropping malformed WebSocket frame");
                            }
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
            _ = ping.tick() => {
                let silent_for = last_inbound.elapsed();
                if silent_for >= SILENCE_TIMEOUT {
                    tracing::warn!(
                        silent_for_ms = silent_for.as_millis(),
                        "closing a WebSocket that stopped answering pings"
                    );
                    break;
                }
                // Both halves of a split socket share one connection, so this
                // is also what flushes any pong the read half queued.
                if sink.send(Frame::ping()).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// [`Transport`] adapter over one peer's plain WebSocket.
///
/// Sending serializes straight to a JSON string and hands it to the spawned
/// pump task's write half; receiving drains the channel that pump feeds from
/// the socket's read half.
///
/// Crate-visible rather than private so the interface-conformance tests in
/// [`crate::testing::wire_conformance`] can exercise it directly through the
/// [`Transport`] trait, the same way they exercise
/// [`crate::testing::fake_wire::FakeTransport`].
pub(crate) struct WebSocketWire<Rx> {
    outgoing: mpsc::UnboundedSender<String>,
    incoming: mpsc::UnboundedReceiver<Rx>,
}

/// The sending half: serializes and hands the text to the pump's write half.
///
/// Not parameterized by the message type: the wire carries JSON text, so any
/// serializable message can go out on it, and which one does is the caller's
/// business rather than this half's.
pub(crate) struct WebSocketSender {
    outgoing: mpsc::UnboundedSender<String>,
}

impl<Tx> TransportSender<Tx> for WebSocketSender
where
    Tx: Serialize + Send + Sync + 'static,
{
    async fn send(&self, message: Tx) -> Result<(), TransportError> {
        let payload = serde_json::to_string(&message)
            .map_err(|error| TransportError::Client(error.to_string()))?;
        self.outgoing
            .send(payload)
            .map_err(|_| TransportError::Client("WebSocket connection closed".to_owned()))
    }
}

impl<Tx, Rx> Transport<Tx, Rx> for WebSocketWire<Rx>
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: Send + 'static,
{
    type Sender = WebSocketSender;
    type Receiver = mpsc::UnboundedReceiver<Rx>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (
            WebSocketSender {
                outgoing: self.outgoing,
            },
            self.incoming,
        )
    }
}

fn wire_channel<Tx, Rx>(
    outgoing: mpsc::UnboundedSender<String>,
    incoming: mpsc::UnboundedReceiver<Rx>,
) -> Channel<Tx, Rx>
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: Send + 'static,
{
    pump(WebSocketWire { outgoing, incoming })
}

/// An axum WebSocket acceptor and its stream of accepted runtime connections.
///
/// One accepted WebSocket is exactly one logical session: there is no
/// caller-chosen identifier and no way to multiplex several logical sessions
/// over one socket.
pub struct ServerTransport<Tx, Rx> {
    incoming_tx: mpsc::UnboundedSender<Channel<Tx, Rx>>,
    incoming: AsyncMutex<mpsc::UnboundedReceiver<Channel<Tx, Rx>>>,
}

impl<Tx, Rx> ServerTransport<Tx, Rx> {
    /// Construct an empty server carrier.
    #[must_use]
    pub fn new() -> Self {
        let (incoming_tx, incoming) = mpsc::unbounded_channel();
        Self {
            incoming_tx,
            incoming: AsyncMutex::new(incoming),
        }
    }

    /// Wait for the next accepted runtime connection.
    pub async fn accept(&self) -> Option<Channel<Tx, Rx>> {
        self.incoming.lock().await.recv().await
    }
}

impl<Tx, Rx> Default for ServerTransport<Tx, Rx> {
    fn default() -> Self {
        Self::new()
    }
}

impl<Tx, Rx> ServerTransport<Tx, Rx>
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: DeserializeOwned + Send + Sync + 'static,
{
    /// Build a router with one route that upgrades an incoming WebSocket
    /// into a runtime connection, delivered on [`ServerTransport::accept`].
    pub fn into_router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/", get(upgrade::<Tx, Rx>))
            .with_state(self)
    }
}

async fn upgrade<Tx, Rx>(
    State(transport): State<Arc<ServerTransport<Tx, Rx>>>,
    ws: WebSocketUpgrade,
) -> Response
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: DeserializeOwned + Send + Sync + 'static,
{
    ws.on_upgrade(move |socket: WebSocket| async move {
        let _ = transport.incoming_tx.send(connect_socket(socket));
    })
}

/// Bridge an already-upgraded WebSocket into its logical channel, spawning the
/// frame pump as an independent task and returning the `Channel` immediately.
///
/// Unlike [`ServerTransport`], this doesn't own routing or session
/// identification - it's the building block for a caller that needs to key
/// connections by something in the upgrade request (e.g. a query parameter):
/// build a plain axum route with a [`WebSocketUpgrade`] extractor, do
/// whatever routing the request needs, and hand the resulting socket here.
pub fn connect_socket<Tx, Rx>(socket: WebSocket) -> Channel<Tx, Rx>
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: DeserializeOwned + Send + Sync + 'static,
{
    let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel();
    tokio::spawn(run_pump(socket, outgoing_rx, incoming_tx));
    wire_channel(outgoing_tx, incoming_rx)
}

/// Build the runtime-side wire over an already-connected WebSocket stream.
///
/// Unlike the service side, the runtime doesn't go through axum: it dials out
/// and drives the socket itself, so this takes an already-connected
/// [`WebSocketStream`] directly.
pub(crate) fn client_wire<Rx, S>(stream: WebSocketStream<S>) -> WebSocketWire<Rx>
where
    Rx: DeserializeOwned + Send + Sync + 'static,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel();
    tokio::spawn(run_pump(stream, outgoing_rx, incoming_tx));

    WebSocketWire {
        outgoing: outgoing_tx,
        incoming: incoming_rx,
    }
}

/// Bridge a runtime-side WebSocket stream into its logical channel.
pub fn connect_runtime<Tx, Rx, S>(stream: WebSocketStream<S>) -> Channel<Tx, Rx>
where
    Tx: Serialize + Send + Sync + 'static,
    Rx: DeserializeOwned + Send + Sync + 'static,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    pump(client_wire::<Rx, S>(stream))
}
