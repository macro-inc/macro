//! A typed duplex channel over the logical protocol stream.

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use super::ports::{Transport, TransportReceiver, TransportSender};

/// One typed endpoint of a duplex channel: sends `Tx` messages, receives
/// `Rx` messages.
///
/// This is the abstraction boundary physical transports adapt to. Unlike a
/// physical WebSocket, a [`Channel`] depends on nothing but
/// `tokio::sync::mpsc`, so it can be exposed to consumers outside this crate.
pub struct Channel<Tx, Rx> {
    /// Sends messages to the counterpart.
    pub tx: UnboundedSender<Tx>,
    /// Receives messages from the counterpart.
    pub rx: UnboundedReceiver<Rx>,
}

// Written by hand rather than derived: tokio's channel halves implement
// `Debug` regardless of `Tx`/`Rx`, so a derive would wrongly add `Tx: Debug,
// Rx: Debug` bounds that aren't actually required.
impl<Tx, Rx> std::fmt::Debug for Channel<Tx, Rx> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Channel")
            .field("tx", &self.tx)
            .field("rx", &self.rx)
            .finish()
    }
}

impl<Tx, Rx> Channel<Tx, Rx> {
    /// Create a pair of connected channel endpoints.
    ///
    /// Messages sent via one endpoint's `tx` are received on the other
    /// endpoint's `rx`, and vice versa.
    #[must_use]
    pub fn duplex() -> (Channel<Tx, Rx>, Channel<Rx, Tx>) {
        let (tx_a, rx_a) = tokio::sync::mpsc::unbounded_channel();
        let (tx_b, rx_b) = tokio::sync::mpsc::unbounded_channel();

        (
            Channel { tx: tx_a, rx: rx_b },
            Channel { tx: tx_b, rx: rx_a },
        )
    }
}

/// Bridge a physical [`Transport`] into a [`Channel`] endpoint.
///
/// Spawns two independent tasks, one per half - which is what taking the
/// carrier apart is for. They run as separate tasks rather than arms of one
/// `select!` specifically so that a `recv` already mid-flight is always polled
/// to completion instead of being raced against, and possibly cancelled by, an
/// outgoing send becoming ready.
///
/// Not exposed outside this crate: outbound adapters adapt to [`Channel`],
/// they don't hand pumps to callers.
pub(crate) fn pump<T, Tx, Rx>(transport: T) -> Channel<Tx, Rx>
where
    T: Transport<Tx, Rx>,
    Tx: Send + 'static,
    Rx: Send + 'static,
{
    let (caller, worker) = Channel::duplex();
    let Channel {
        tx: worker_tx,
        rx: mut worker_rx,
    } = worker;
    let (sender, mut receiver) = transport.split();

    tokio::spawn(async move {
        while let Some(outgoing) = worker_rx.recv().await {
            if sender.send(outgoing).await.is_err() {
                break;
            }
        }
    });

    tokio::spawn(async move {
        while let Ok(Some(incoming)) = receiver.recv().await {
            if worker_tx.send(incoming).is_err() {
                break;
            }
        }
    });

    caller
}

/// A [`Channel`] is already a carrier taken apart, so it is one directly -
/// no adapter, and nothing to lock. This is what a caller holding a `Channel`
/// (an accepted WebSocket routed by hand, a test double) hands to anything
/// wanting the port.
impl<Tx, Rx> Transport<Tx, Rx> for Channel<Tx, Rx>
where
    Tx: Send + Sync + 'static,
    Rx: Send + 'static,
{
    type Sender = UnboundedSender<Tx>;
    type Receiver = UnboundedReceiver<Rx>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (self.tx, self.rx)
    }
}
