//! The physical transport port.

use std::future::Future;

/// A failure while using a physical transport carrier.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum TransportError {
    /// A carrier client operation failed.
    #[error("transport client failed: {0}")]
    Client(String),
}

/// The sending half of a physical carrier.
///
/// Shared rather than owned: many callers may send on one carrier, which is
/// what lets a connection carry several sessions.
pub trait TransportSender<Tx>: Send + Sync + 'static {
    /// Send one logical message to the counterpart.
    fn send(&self, message: Tx) -> impl Future<Output = Result<(), TransportError>> + Send;
}

/// The receiving half of a physical carrier.
pub trait TransportReceiver<Rx>: Send + Sync + 'static {
    /// Receive the next logical message from the counterpart.
    ///
    /// Returns `Ok(None)` once the counterpart has closed the connection.
    fn recv(&mut self) -> impl Future<Output = Result<Option<Rx>, TransportError>> + Send;
}

/// A physical carrier for one logical connection: sends `Tx` messages,
/// receives `Rx` messages.
///
/// This is the port outbound adapters (a plain WebSocket, an in-memory test
/// double, or any other physical carrier) implement. A carrier exists only to
/// be taken apart: [`crate::domain::channel::pump`] bridges one into a
/// [`crate::domain::channel::Channel`], and a connection holding one keeps the
/// sender to share and hands the receiver to whichever task reads it.
pub trait Transport<Tx, Rx> {
    /// This carrier's sending half.
    type Sender: TransportSender<Tx>;
    /// This carrier's receiving half.
    type Receiver: TransportReceiver<Rx>;

    /// Take the carrier apart into the half that is shared and the half that
    /// is owned.
    fn split(self) -> (Self::Sender, Self::Receiver);
}

/// An unbounded sender is already a sending half: a closed counterpart is the
/// only way it fails.
#[cfg(feature = "transport")]
impl<Tx: Send + Sync + 'static> TransportSender<Tx> for tokio::sync::mpsc::UnboundedSender<Tx> {
    async fn send(&self, message: Tx) -> Result<(), TransportError> {
        tokio::sync::mpsc::UnboundedSender::send(self, message)
            .map_err(|_| TransportError::Client("the connection is closed".to_owned()))
    }
}

/// A bounded receiver is already a receiving half, and an exclusive one.
#[cfg(feature = "transport")]
impl<Rx: Send + 'static> TransportReceiver<Rx> for tokio::sync::mpsc::Receiver<Rx> {
    async fn recv(&mut self) -> Result<Option<Rx>, TransportError> {
        Ok(tokio::sync::mpsc::Receiver::recv(self).await)
    }
}

/// An unbounded receiver is already a receiving half, and an exclusive one.
#[cfg(feature = "transport")]
impl<Rx: Send + 'static> TransportReceiver<Rx> for tokio::sync::mpsc::UnboundedReceiver<Rx> {
    async fn recv(&mut self) -> Result<Option<Rx>, TransportError> {
        Ok(tokio::sync::mpsc::UnboundedReceiver::recv(self).await)
    }
}
