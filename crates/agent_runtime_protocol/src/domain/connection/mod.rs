//! Role-oriented logical protocol connections.
//!
//! A connection hosts exactly one agent execution, so there is no routing
//! table: the single [`agent_client_protocol::Channel`] handed back by
//! [`ServerConnection::connect`] and [`RuntimeConnection::connect`] carries
//! all of this connection's ACP traffic.

use std::future::Future;

use agent_client_protocol::{Channel as AcpChannel, TransportFrame};
use futures::StreamExt;
use tokio::sync::mpsc::UnboundedSender;

use crate::domain::channel::Channel;
use crate::domain::schema::v0::{AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage};

#[cfg(test)]
mod test;

/// The logical channel carried by an Agent Service's side of a connection.
pub type ServerChannel = Channel<ToRuntimeMessage, ToServerMessage>;
/// The logical channel carried by an Agent Runtime's side of a connection.
pub type RuntimeChannel = Channel<ToServerMessage, ToRuntimeMessage>;

/// Handles a system event delivered to an Agent Service.
///
/// Use `()` when the connection only carries ACP. It ignores any system event.
pub trait SystemEventHandler: Send + Sync + 'static {
    /// Observe a runtime or agent state transition.
    fn handle(&self, event: SystemEvent) -> impl Future<Output = ()> + Send;
}

impl SystemEventHandler for () {
    fn handle(&self, _event: SystemEvent) -> impl Future<Output = ()> + Send {
        std::future::ready(())
    }
}

/// A failure while using a logical protocol connection.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ConnectionError {
    /// The logical connection has closed.
    #[error("connection closed")]
    Closed,
}

/// Agent Service-side access to one logical runtime connection.
pub struct ServerConnection {
    driver: tokio::task::AbortHandle,
}

impl ServerConnection {
    /// Attach the service role to a logical message channel.
    ///
    /// Returns the connection handle alongside an official ACP
    /// [`AcpChannel`] for the single agent execution this connection hosts.
    #[must_use]
    pub fn connect<H>(channel: ServerChannel, system_events: H) -> (Self, AcpChannel)
    where
        H: SystemEventHandler,
    {
        let Channel {
            tx: outbound,
            rx: inbound,
        } = channel;
        let (acp, acp_driver) = AcpChannel::duplex();
        let driver =
            tokio::spawn(run_server(inbound, outbound, system_events, acp_driver)).abort_handle();

        (Self { driver }, acp)
    }
}

impl Drop for ServerConnection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

/// Agent Runtime-side access to one logical service connection.
pub struct RuntimeConnection {
    outbound: UnboundedSender<ToServerMessage>,
    driver: tokio::task::AbortHandle,
}

impl RuntimeConnection {
    /// Attach the runtime role to a logical message channel.
    ///
    /// Returns the connection handle alongside an official ACP
    /// [`AcpChannel`] for the single agent execution this connection hosts.
    #[must_use]
    pub fn connect(channel: RuntimeChannel) -> (Self, AcpChannel) {
        let Channel {
            tx: outbound,
            rx: inbound,
        } = channel;
        let (acp, acp_driver) = AcpChannel::duplex();
        let driver =
            tokio::spawn(run_runtime(inbound, outbound.clone(), acp_driver)).abort_handle();
        (Self { outbound, driver }, acp)
    }

    /// Send a system event notification to the Agent Service.
    pub fn system_event(&self, event: SystemEvent) -> Result<(), ConnectionError> {
        self.outbound
            .send(ToServerMessage::Event { event })
            .map_err(|_| ConnectionError::Closed)
    }
}

impl Drop for RuntimeConnection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

async fn run_server<H>(
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>,
    outbound: UnboundedSender<ToRuntimeMessage>,
    system_events: H,
    mut acp: AcpChannel,
) where
    H: SystemEventHandler,
{
    // Whether the caller's ACP channel is still open. A caller that only
    // wants events is free to drop its ACP channel immediately; that must
    // not tear down event handling, so once the ACP side closes we simply
    // stop selecting on it instead of breaking the loop.
    let mut acp_open = true;
    loop {
        tokio::select! {
            message = inbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                match message {
                    ToServerMessage::Event { event } => {
                        system_events.handle(event).await;
                    }
                    ToServerMessage::Acp(AcpMessage(raw)) => {
                        if acp_open
                            && acp.tx.unbounded_send(TransportFrame::Single(raw)).is_err()
                        {
                            acp_open = false;
                        }
                    }
                }
            }
            message = acp.rx.next(), if acp_open => {
                match message {
                    Some(TransportFrame::Single(raw)) => {
                        if outbound.send(ToRuntimeMessage::Acp(AcpMessage(raw))).is_err() {
                            break;
                        }
                    }
                    // This connection carries exactly one `AcpMessage` per
                    // outer envelope value, so there is no envelope shape to
                    // relay a batch or a malformed frame as. Neither has ever
                    // been observed here in practice - batching is opt-in on
                    // the wire and nothing on either side of this relay asks
                    // for it - so this keeps the old behaviour: anything that
                    // is not a single message closes this side, same as a
                    // stream that ended or a transport error used to.
                    _ => acp_open = false,
                }
            }
        }
    }
}

async fn run_runtime(
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<ToRuntimeMessage>,
    outbound: UnboundedSender<ToServerMessage>,
    mut acp: AcpChannel,
) {
    // See the matching comment in `run_server`: dropping the ACP channel must
    // not tear down this connection - only an actual transport failure does.
    let mut acp_open = true;
    loop {
        tokio::select! {
            message = inbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                match message {
                    ToRuntimeMessage::Acp(AcpMessage(raw)) => {
                        if acp_open
                            && acp.tx.unbounded_send(TransportFrame::Single(raw)).is_err()
                        {
                            acp_open = false;
                        }
                    }
                }
            }
            message = acp.rx.next(), if acp_open => {
                match message {
                    Some(TransportFrame::Single(raw)) => {
                        if outbound.send(ToServerMessage::Acp(AcpMessage(raw))).is_err() {
                            break;
                        }
                    }
                    // See the matching comment in `run_server`.
                    _ => acp_open = false,
                }
            }
        }
    }
}
