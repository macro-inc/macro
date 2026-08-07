//! The envelope adapter over a sidecar's raw ACP WebSocket.
//!
//! The sidecar (`container/sidecar`) is a byte pipe: it speaks bare ACP
//! JSON-RPC, one message per WebSocket frame, and knows nothing about the
//! runtime protocol. The domain's port is one level up - it wants
//! [`ToServerMessage`]/[`ToRuntimeMessage`] envelopes and a lifecycle event
//! stream. This type is that step: it wraps and unwraps `Acp` variants, and
//! originates the one [`SystemEvent`] the domain acts on.

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::ports::{Transport, TransportError};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

#[cfg(test)]
mod test;

/// A [`Transport`] carrying the runtime protocol over a sidecar's ACP socket.
///
/// Not `Clone` itself - `recv` has to be exclusive - so containers share one
/// through an `Arc`, which is what makes them cloneable.
pub struct SidecarTransport {
    outbound: mpsc::UnboundedSender<Outbound>,
    inbound: AsyncMutex<mpsc::UnboundedReceiver<ToServerMessage>>,
}

struct Outbound {
    frame: RawJsonRpcMessage,
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
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();

        // Queued before the pump exists, so nothing the agent says can arrive
        // ahead of it. See the module docs.
        let ready = ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        };
        let _ = inbound_tx.send(ready);

        tokio::spawn(pump(socket, outbound_rx, inbound_tx));

        Self {
            outbound: outbound_tx,
            inbound: AsyncMutex::new(inbound_rx),
        }
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for SidecarTransport {
    async fn send(&self, message: ToRuntimeMessage) -> Result<(), TransportError> {
        // A message this transport has no way to deliver is dropped rather than
        // failed: the sidecar carries ACP and nothing else, and refusing would
        // tear down a session over a message it never needed.
        let ToRuntimeMessage::Acp(AcpMessage(frame)) = message else {
            tracing::warn!("dropping a non-acp message the sidecar cannot carry");
            return Ok(());
        };

        let (completed, result) = oneshot::channel();
        self.outbound
            .send(Outbound { frame, completed })
            .map_err(|_| TransportError::Client("the sidecar connection is closed".to_owned()))?;
        result
            .await
            .map_err(|_| TransportError::Client("the sidecar connection is closed".to_owned()))?
    }

    async fn recv(&self) -> Result<Option<ToServerMessage>, TransportError> {
        Ok(self.inbound.lock().await.recv().await)
    }
}

/// Relay frames until either side closes.
async fn pump<Socket>(
    socket: WebSocketStream<Socket>,
    mut outbound: mpsc::UnboundedReceiver<Outbound>,
    inbound: mpsc::UnboundedSender<ToServerMessage>,
) where
    Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut socket_tx, mut socket_rx) = socket.split();

    loop {
        tokio::select! {
            outgoing = outbound.recv() => {
                let Some(Outbound { frame, completed }) = outgoing else { break };
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
                if let Err(error) = socket_tx.send(Message::Text(json.into())).await {
                    let _ = completed.send(Err(TransportError::Client(error.to_string())));
                    break;
                }
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
