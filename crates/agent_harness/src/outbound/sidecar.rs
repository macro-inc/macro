//! The envelope adapter over a sidecar's raw ACP WebSocket.
//!
//! The sidecar (`container/sidecar`) is a byte pipe: it speaks bare ACP
//! JSON-RPC, one message per WebSocket frame, and knows nothing about the
//! runtime protocol. The domain's port is one level up - it wants
//! [`ToServerMessage`]/[`ToRuntimeMessage`] envelopes and a lifecycle event
//! stream. This type is that step: it wraps and unwraps `Acp` variants, and
//! originates the one [`SystemEvent`] the domain acts on.

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::ports::{Transport, TransportError, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tracing::Instrument as _;
use tracing::instrument::WithSubscriber as _;

#[cfg(test)]
mod test;

/// A [`Transport`] carrying the runtime protocol over a sidecar's ACP socket.
///
/// Not `Clone` itself - `recv` has to be exclusive - so containers share one
/// through an `Arc`, which is what makes them cloneable.
pub struct SidecarTransport {
    outbound: mpsc::UnboundedSender<OutboundFrame>,
    inbound: mpsc::UnboundedReceiver<ToServerMessage>,
}

/// The sidecar's sending half.
pub struct SidecarSender {
    outbound: mpsc::UnboundedSender<OutboundFrame>,
}

struct OutboundFrame {
    frame: RawJsonRpcMessage,
    parent: tracing::Span,
    completed: oneshot::Sender<Result<(), TransportError>>,
}

impl SidecarTransport {
    /// Wire a connected sidecar socket up as a runtime protocol transport.
    ///
    /// The pump runs on its own task until either side closes.
    #[must_use]
    pub fn connect<Socket>(socket: WebSocketStream<Socket>) -> Self
    where
        Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        Self::connect_observed(socket, || {})
    }

    /// Wire a sidecar socket up and observe each valid inbound ACP frame.
    #[must_use]
    pub fn connect_observed<Socket, Observer>(
        socket: WebSocketStream<Socket>,
        on_frame: Observer,
    ) -> Self
    where
        Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
        Observer: Fn() + Send + 'static,
    {
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();

        // Queued before the pump exists, so nothing the agent says can arrive
        // ahead of it. See the module docs.
        let ready = ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        };
        let _ = inbound_tx.send(ready);

        tokio::spawn(pump(socket, outbound_rx, inbound_tx, on_frame).with_current_subscriber());

        Self {
            outbound: outbound_tx,
            inbound: inbound_rx,
        }
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for SidecarTransport {
    type Sender = SidecarSender;
    type Receiver = mpsc::UnboundedReceiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (
            SidecarSender {
                outbound: self.outbound,
            },
            self.inbound,
        )
    }
}

impl TransportSender<ToRuntimeMessage> for SidecarSender {
    async fn send(&self, message: ToRuntimeMessage) -> Result<(), TransportError> {
        // A message this transport has no way to deliver is dropped rather than
        // failed: the sidecar carries ACP and nothing else, and refusing would
        // tear down a session over a message it never needed.
        let ToRuntimeMessage::Acp(AcpMessage(frame)) = message else {
            tracing::warn!("dropping a non-acp message the sidecar cannot carry");
            return Ok(());
        };

        let parent = tracing::Span::current();
        let (completed, result) = oneshot::channel();
        self.outbound
            .send(OutboundFrame {
                frame,
                parent,
                completed,
            })
            .map_err(|_| TransportError::Client("the sidecar connection is closed".to_owned()))?;
        result
            .await
            .map_err(|_| TransportError::Client("the sidecar connection is closed".to_owned()))?
    }
}

/// Relay frames until either side closes.
async fn pump<Socket, Observer>(
    socket: WebSocketStream<Socket>,
    mut outbound: mpsc::UnboundedReceiver<OutboundFrame>,
    inbound: mpsc::UnboundedSender<ToServerMessage>,
    on_frame: Observer,
) where
    Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    Observer: Fn() + Send + 'static,
{
    let (mut socket_tx, mut socket_rx) = socket.split();

    loop {
        tokio::select! {
            outgoing = outbound.recv() => {
                let Some(OutboundFrame { frame, parent, completed }) = outgoing else { break };
                let method = frame_method(&frame);
                // Serialization failure is fatal for this session because the
                // caller's action cannot reach the agent.
                let json = match serde_json::to_string(&frame) {
                    Ok(json) => json,
                    Err(error) => {
                        tracing::error!(error = ?error, "could not serialize an outgoing acp frame");
                        let _ = completed.send(Err(TransportError::Client(
                            "could not serialize an outgoing ACP frame".to_owned(),
                        )));
                        continue;
                    }
                };
                let send = socket_tx.send(Message::Text(json.into()));
                let span = tracing::info_span!(
                    parent: &parent,
                    "agent.acp.websocket_send",
                    network.protocol.name = "websocket",
                    rpc.system.name = tracing::field::Empty,
                    rpc.method = tracing::field::Empty,
                    otel.status_code = tracing::field::Empty,
                    otel.status_description = tracing::field::Empty,
                );
                if let Some(method) = method {
                    span.record("rpc.system.name", "jsonrpc");
                    span.record("rpc.method", method);
                }
                let result = send
                    .instrument(span.clone())
                    .await
                    .map_err(|error| format!("sending an ACP websocket frame failed: {error}"));
                if let Err(error) = result {
                    span.record("otel.status_code", "ERROR");
                    span.record("otel.status_description", tracing::field::display(&error));
                    drop(span);
                    let _ = completed.send(Err(TransportError::Client(error)));
                    break;
                }
                drop(span);
                let _ = completed.send(Ok(()));
            }
            incoming = socket_rx.next() => {
                let json = match incoming {
                    Some(Ok(Message::Text(text))) => text.to_string(),
                    Some(Ok(Message::Binary(data))) => match String::from_utf8(data.to_vec()) {
                        Ok(text) => text,
                        Err(error) => {
                            tracing::error!(error = ?error, "agent sent a non-utf8 acp frame");
                            continue;
                        }
                    },
                    // Not part of the protocol.
                    Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                };

                match serde_json::from_str::<RawJsonRpcMessage>(&json) {
                    Ok(frame) => {
                        on_frame();
                        if inbound.send(ToServerMessage::Acp(AcpMessage(frame))).is_err() {
                            break;
                        }
                    }
                    // One unparseable frame is not fatal: the agent keeps
                    // talking, and dropping the session would lose the rest.
                    Err(error) => {
                        tracing::error!(error = ?error, %json, "agent sent an unparseable acp frame");
                    }
                }
            }
        }
    }

    tracing::debug!("sidecar pump finished");
}

fn frame_method(frame: &RawJsonRpcMessage) -> Option<&str> {
    match frame {
        RawJsonRpcMessage::Request(request) => Some(request.method.as_ref()),
        RawJsonRpcMessage::Notification(notification) => Some(notification.method.as_ref()),
        RawJsonRpcMessage::Response(_) => None,
    }
}
