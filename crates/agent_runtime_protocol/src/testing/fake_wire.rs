//! A deterministic [`Transport`] test double.

use std::sync::{Arc, Mutex};

use futures::StreamExt;
use futures::channel::mpsc;

use crate::domain::ports::{Transport, TransportError};

#[cfg(test)]
mod test;

/// A deterministic [`Transport`] double for testing pump-loop behavior
/// without a real socket.
///
/// Construct a transport and its [`FakeTransportProbe`] together with
/// [`FakeTransport::new`].
pub struct FakeTransport<Tx, Rx> {
    fail_next_recv: Arc<Mutex<Option<String>>>,
    fail_next_send: Arc<Mutex<Option<String>>>,
    incoming: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<Rx>>>,
    sent: mpsc::UnboundedSender<Tx>,
}

/// Observes and controls a [`FakeTransport`] from outside the transport port.
pub struct FakeTransportProbe<Tx, Rx> {
    fail_next_recv: Arc<Mutex<Option<String>>>,
    fail_next_send: Arc<Mutex<Option<String>>>,
    sent: mpsc::UnboundedReceiver<Tx>,
    incoming: mpsc::UnboundedSender<Rx>,
}

impl<Tx, Rx> FakeTransport<Tx, Rx> {
    /// Construct a fake transport and the probe used to observe and control it.
    #[must_use]
    pub fn new() -> (Self, FakeTransportProbe<Tx, Rx>) {
        let (sent_tx, sent_rx) = mpsc::unbounded();
        let (incoming_tx, incoming_rx) = mpsc::unbounded();
        let fail_next_recv = Arc::new(Mutex::new(None));
        let fail_next_send = Arc::new(Mutex::new(None));
        (
            Self {
                fail_next_recv: Arc::clone(&fail_next_recv),
                fail_next_send: Arc::clone(&fail_next_send),
                incoming: Arc::new(tokio::sync::Mutex::new(incoming_rx)),
                sent: sent_tx,
            },
            FakeTransportProbe {
                fail_next_recv,
                fail_next_send,
                sent: sent_rx,
                incoming: incoming_tx,
            },
        )
    }
}

impl<Tx, Rx> Transport<Tx, Rx> for FakeTransport<Tx, Rx>
where
    Tx: Send + 'static,
    Rx: Send + 'static,
{
    async fn send(&self, message: Tx) -> Result<(), TransportError> {
        let _ = self.sent.unbounded_send(message);
        if let Some(reason) = self
            .fail_next_send
            .lock()
            .expect("fake transport mutex poisoned")
            .take()
        {
            return Err(TransportError::Client(reason));
        }
        Ok(())
    }

    async fn recv(&self) -> Result<Option<Rx>, TransportError> {
        if let Some(reason) = self
            .fail_next_recv
            .lock()
            .expect("fake transport mutex poisoned")
            .take()
        {
            return Err(TransportError::Client(reason));
        }
        let mut incoming = self.incoming.lock().await;
        Ok(incoming.next().await)
    }
}

impl<Tx, Rx> FakeTransportProbe<Tx, Rx> {
    /// Fail the next `recv` call with the given reason.
    pub fn fail_next_recv(&mut self, reason: impl Into<String>) {
        *self
            .fail_next_recv
            .lock()
            .expect("fake transport mutex poisoned") = Some(reason.into());
    }

    /// Fail the next `send` call with the given reason.
    ///
    /// The attempted message is still recorded and observable through
    /// [`FakeTransportProbe::next_send`].
    pub fn fail_next_send(&mut self, reason: impl Into<String>) {
        *self
            .fail_next_send
            .lock()
            .expect("fake transport mutex poisoned") = Some(reason.into());
    }

    /// Wait for the next message attempted through `send`, regardless of outcome.
    pub async fn next_send(&mut self) -> Tx {
        self.sent
            .next()
            .await
            .expect("fake transport should remain open")
    }

    /// Push one message for the transport's `recv` to yield.
    pub fn push_incoming(&mut self, message: Rx) {
        self.incoming
            .unbounded_send(message)
            .expect("fake transport should remain open");
    }
}
