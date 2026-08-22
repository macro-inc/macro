//! The envelope adapter over an in-process ACP byte pipe.
//!
//! The counterpart of [`crate::outbound::sidecar`], for an agent served in
//! this process instead of behind a websocket: `cursor_cloud_agents::serve`
//! reads and writes newline-delimited ACP JSON-RPC on the other end of a
//! `tokio::io::duplex`, and this type wraps our end in the
//! [`ToRuntimeMessage`]/[`ToServerMessage`] envelopes the session domain
//! speaks. Same contract as the sidecar: bare ACP frames one per line, an
//! [`SystemEvent::AcpReady`] queued before anything the agent says, and
//! non-ACP runtime messages dropped rather than failed.

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::ports::{Transport, TransportError, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// A [`Transport`] carrying the runtime protocol over an in-process ACP pipe.
///
/// Not `Clone` itself — `recv` has to be exclusive — so containers share one
/// through an `Arc`, which is what makes them cloneable.
pub struct PipeTransport {
    outbound: mpsc::UnboundedSender<Outbound>,
    inbound: mpsc::UnboundedReceiver<ToServerMessage>,
}

/// The pipe's sending half.
pub struct PipeSender {
    outbound: mpsc::UnboundedSender<Outbound>,
}

struct Outbound {
    frame: RawJsonRpcMessage,
    completed: oneshot::Sender<Result<(), TransportError>>,
}

impl PipeTransport {
    /// Wire our end of a byte pipe up as a runtime protocol transport.
    ///
    /// The pump runs on its own task until either side closes. It owns both
    /// halves of `pipe`, so dropping this transport (which closes the
    /// outbound queue) ends the pump, closes the pipe, and lets the serve
    /// loop on the other end see EOF and finish — nothing leaks.
    #[must_use]
    pub fn connect<Pipe>(pipe: Pipe) -> Self
    where
        Pipe: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        Self::connect_observed(pipe, || {}, CancellationToken::new())
    }

    /// [`Self::connect`], with each relayed frame observed and a shutdown
    /// handle.
    ///
    /// `on_frame` fires for every frame in either direction — the idle
    /// reaper's activity signal. Cancelling `shutdown` ends the pump, which
    /// closes the pipe and lets the served agent see EOF: the Cursor
    /// counterpart of stopping an idle sandbox, except nothing here costs
    /// anything to keep except its 1s cursor.com poll — which dies with it.
    #[must_use]
    pub fn connect_observed<Pipe, Observer>(
        pipe: Pipe,
        on_frame: Observer,
        shutdown: CancellationToken,
    ) -> Self
    where
        Pipe: AsyncRead + AsyncWrite + Unpin + Send + 'static,
        Observer: Fn() + Send + 'static,
    {
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();

        // Queued before the pump exists, so nothing the agent says can arrive
        // ahead of it — the session machine starts its handshake on AcpReady.
        let ready = ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        };
        let _ = inbound_tx.send(ready);

        tokio::spawn(pump(pipe, outbound_rx, inbound_tx, on_frame, shutdown));

        Self {
            outbound: outbound_tx,
            inbound: inbound_rx,
        }
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for PipeTransport {
    type Sender = PipeSender;
    type Receiver = mpsc::UnboundedReceiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (
            PipeSender {
                outbound: self.outbound,
            },
            self.inbound,
        )
    }
}

impl TransportSender<ToRuntimeMessage> for PipeSender {
    async fn send(&self, message: ToRuntimeMessage) -> Result<(), TransportError> {
        // A message this transport has no way to deliver is dropped rather
        // than failed: the pipe carries ACP and nothing else, and refusing
        // would tear down a session over a message it never needed.
        let ToRuntimeMessage::Acp(AcpMessage(frame)) = message else {
            tracing::warn!("dropping a non-acp message the acp pipe cannot carry");
            return Ok(());
        };

        let (completed, result) = oneshot::channel();
        self.outbound
            .send(Outbound { frame, completed })
            .map_err(|_| TransportError::Client("the acp pipe is closed".to_owned()))?;
        result
            .await
            .map_err(|_| TransportError::Client("the acp pipe is closed".to_owned()))?
    }
}

/// Relay frames until either side closes or `shutdown` is cancelled.
async fn pump<Pipe, Observer>(
    pipe: Pipe,
    mut outbound: mpsc::UnboundedReceiver<Outbound>,
    inbound: mpsc::UnboundedSender<ToServerMessage>,
    on_frame: Observer,
    shutdown: CancellationToken,
) where
    Pipe: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    Observer: Fn() + Send + 'static,
{
    let (reader, mut writer) = tokio::io::split(pipe);
    let mut lines = BufReader::new(reader).lines();

    loop {
        tokio::select! {
            () = shutdown.cancelled() => break,
            outgoing = outbound.recv() => {
                let Some(Outbound { frame, completed }) = outgoing else { break };
                let mut json = match serde_json::to_string(&frame) {
                    Ok(json) => json,
                    Err(error) => {
                        tracing::error!(error = ?error, "could not serialize an outgoing acp frame");
                        let _ = completed.send(Err(TransportError::Client(
                            "could not serialize an outgoing ACP frame".to_owned(),
                        )));
                        continue;
                    }
                };
                json.push('\n');
                if let Err(error) = writer.write_all(json.as_bytes()).await {
                    let _ = completed.send(Err(TransportError::Client(error.to_string())));
                    break;
                }
                if let Err(error) = writer.flush().await {
                    let _ = completed.send(Err(TransportError::Client(error.to_string())));
                    break;
                }
                on_frame();
                let _ = completed.send(Ok(()));
            }
            incoming = lines.next_line() => {
                let line = match incoming {
                    Ok(Some(line)) => line,
                    // EOF: the agent's serve loop ended.
                    Ok(None) => break,
                    Err(error) => {
                        tracing::warn!(error = ?error, "acp pipe read failed");
                        break;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<RawJsonRpcMessage>(&line) {
                    Ok(frame) => {
                        on_frame();
                        let message = ToServerMessage::Acp(AcpMessage(frame));
                        if inbound.send(message).is_err() {
                            break; // receiver dropped: the session is gone
                        }
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error, line, "dropping a malformed acp frame");
                    }
                }
            }
        }
    }
}
