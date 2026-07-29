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

/// A physical carrier for one logical connection: sends `Tx` messages,
/// receives `Rx` messages.
///
/// This is the port outbound adapters (a plain WebSocket, an in-memory test
/// double, or any other physical carrier) implement. [`crate::domain::channel::pump`]
/// bridges any [`Transport`] into a [`crate::domain::channel::Channel`].
pub trait Transport<Tx, Rx> {
    /// Send one logical message to the counterpart.
    fn send(&self, message: Tx) -> impl Future<Output = Result<(), TransportError>> + Send;

    /// Receive the next logical message from the counterpart.
    ///
    /// Returns `Ok(None)` once the counterpart has closed the connection.
    fn recv(&self) -> impl Future<Output = Result<Option<Rx>, TransportError>> + Send;
}
