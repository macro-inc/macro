//! Bridge a sidecar WebSocket to typed ACP frames.
//!
//! Shared by both providers: Daytona dials the sidecar through a preview URL
//! and Namespace through an ingress, but past the dial the protocol is
//! identical, so the pump is written once here.
//!
//! ## One message, one frame
//!
//! There is no buffering, splitting, or partial-line handling, because the
//! sidecar does not stream bytes. `container/sidecar` reads the agent's stdout
//! with `BufReader::lines()` and sends each complete line as one WebSocket
//! text message; WebSocket is message-oriented and tungstenite reassembles
//! fragmented frames before yielding a `Message`. So every message that
//! arrives is exactly one JSON value.
//!
//! The same holds outbound, with one wrinkle worth not re-learning: the
//! sidecar appends the newline to the agent's stdin itself, so frames are sent
//! *without* a trailing newline. Adding one here puts a blank line into the
//! agent's stdin after every frame.
//!
//! If the sidecar ever becomes a genuine byte pipe, this is where the framing
//! would come back - and at that point `tokio_util::codec` over
//! `ws_stream_tungstenite` is a better answer than a hand-rolled buffer.

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::channel::Channel;
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

use crate::domain::ports::AcpFrames;

/// Wire a connected sidecar socket to a channel of typed ACP frames.
///
/// Returns the caller's end; the pump runs on its own task until either side
/// closes.
pub fn spawn<Socket>(socket: WebSocketStream<Socket>) -> AcpFrames
where
    Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (ours, theirs) = Channel::duplex();
    tokio::spawn(pump(socket, theirs));
    ours
}

/// Relay frames until either side closes.
async fn pump<Socket>(
    socket: WebSocketStream<Socket>,
    side: Channel<RawJsonRpcMessage, RawJsonRpcMessage>,
) where
    Socket: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut socket_tx, mut socket_rx) = socket.split();
    let Channel { tx, mut rx } = side;

    loop {
        tokio::select! {
            outbound = rx.recv() => {
                let Some(frame) = outbound else { break };
                // A frame we just built failing to serialize is not worth
                // tearing the session down over.
                let Ok(json) = serde_json::to_string(&frame) else {
                    tracing::error!("could not serialize an outgoing acp frame");
                    continue;
                };
                if socket_tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            inbound = socket_rx.next() => {
                let json = match inbound {
                    Some(Ok(Message::Text(text))) => text.to_string(),
                    Some(Ok(Message::Binary(data))) => match String::from_utf8(data.to_vec()) {
                        Ok(text) => text,
                        Err(error) => {
                            tracing::error!(?error, "agent sent a non-utf8 acp frame");
                            continue;
                        }
                    },
                    // Not part of the protocol.
                    Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => continue,
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                };

                match serde_json::from_str::<RawJsonRpcMessage>(&json) {
                    Ok(frame) => {
                        if tx.send(frame).is_err() {
                            break;
                        }
                    }
                    // One unparseable frame is not fatal: the agent keeps
                    // talking, and dropping the session would lose the rest.
                    Err(error) => {
                        tracing::error!(?error, %json, "agent sent an unparseable acp frame");
                    }
                }
            }
        }
    }
    tracing::debug!("sidecar pump finished");
}
