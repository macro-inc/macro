//! Reusable utilities for asserting protocol JSON at the wire boundary.
//!
//! A wire test is a direction-labelled transcript of complete JSON messages
//! represented as [`serde_json::Value`]s. It does not deserialize the
//! messages into protocol types before comparing them. Consequently, it can
//! catch changes to field names and JSON shapes. There is no JSON-RPC
//! envelope to account for: each message here is exactly what one WebSocket
//! text frame carries, the logical envelope itself.
//!
//! When testing an Agent Runtime, messages directed to the runtime are
//! injected and messages directed to the server are asserted. When testing an
//! Agent Service, the same transcript is interpreted in the opposite way.
//!
//! A conversation is defined without choosing the peer under test:
//!
//! ```text
//! WireTest::new([
//!     to_server(json!({
//!         "type": "event",
//!         "event": "runtime/stopping"
//!     })),
//! ])
//! ```

use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::future::Future;

use serde_json::Value;

/// A deterministic [`crate::domain::ports::Transport`] test double.
pub mod fake_wire;

#[cfg(test)]
mod test;
#[cfg(test)]
mod wire_conformance;

/// The destination of a JSON message on the protocol wire.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    /// The message travels from the Agent Service to the Agent Runtime.
    ToRuntime,
    /// The message travels from the Agent Runtime to the Agent Service.
    ToServer,
}

impl Display for Direction {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::ToRuntime => formatter.write_str("runtime"),
            Self::ToServer => formatter.write_str("server"),
        }
    }
}

/// One complete JSON message and its destination on the protocol wire.
#[derive(Clone, Debug, PartialEq)]
pub struct WireMessage {
    message: Value,
    direction: Direction,
}

impl WireMessage {
    /// Construct a direction-labelled wire message.
    pub fn new(direction: Direction, message: Value) -> Self {
        Self { message, direction }
    }

    /// Return this message's wire destination.
    pub fn direction(&self) -> Direction {
        self.direction
    }

    /// Borrow the complete JSON message.
    pub fn message(&self) -> &Value {
        &self.message
    }

    /// Consume the wrapper and return the complete JSON message.
    pub fn into_message(self) -> Value {
        self.message
    }
}

/// Wrap a wire message sent from the Agent Service to the Agent Runtime.
pub fn to_runtime(message: Value) -> WireMessage {
    WireMessage::new(Direction::ToRuntime, message)
}

/// Wrap a wire message sent from the Agent Runtime to the Agent Service.
pub fn to_server(message: Value) -> WireMessage {
    WireMessage::new(Direction::ToServer, message)
}

/// The protocol peer exercised by a wire test.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PeerUnderTest {
    /// Exercise an Agent Runtime implementation.
    Runtime,
    /// Exercise an Agent Service implementation.
    Server,
}

impl PeerUnderTest {
    fn receives(self, direction: Direction) -> bool {
        matches!(
            (self, direction),
            (Self::Runtime, Direction::ToRuntime) | (Self::Server, Direction::ToServer)
        )
    }
}

/// An adapter between a wire test and the peer under test.
///
/// Implementations may drive an in-memory connection, a WebSocket, or a
/// spawned process. They must expose complete, decoded JSON messages without
/// translating them into typed protocol values. Sending and receiving are
/// named relative to the subject under test, avoiding assumptions about which
/// peer opened the connection.
///
/// Implementations SHOULD place a timeout around receive operations; the
/// runner deliberately does not depend on a particular async executor.
pub trait WireHarness: Send {
    /// An error produced while communicating with the subject under test.
    type Error: Error + Send + Sync + 'static;

    /// Put a complete JSON message onto the wire toward the subject under test.
    fn send_to_subject(
        &mut self,
        message: Value,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Receive the next complete JSON message emitted onto the wire by the subject.
    fn receive_from_subject(&mut self) -> impl Future<Output = Result<Value, Self::Error>> + Send;
}

/// A direction-labelled JSON transcript that can exercise either protocol peer.
///
/// Outbound messages are compared using [`serde_json::Value`] equality. This
/// asserts the complete decoded JSON value, while intentionally ignoring
/// insignificant textual differences such as whitespace and object-key order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WireTest {
    messages: Vec<WireMessage>,
}

impl WireTest {
    /// Construct a wire test from complete JSON messages in expected wire order.
    pub fn new(messages: impl IntoIterator<Item = WireMessage>) -> Self {
        Self {
            messages: messages.into_iter().collect(),
        }
    }

    /// Borrow the direction-labelled wire transcript.
    pub fn messages(&self) -> &[WireMessage] {
        &self.messages
    }

    /// Run this wire test against an Agent Runtime implementation.
    pub async fn run_runtime<H>(&self, harness: &mut H) -> Result<(), WireTestFailure<H::Error>>
    where
        H: WireHarness,
    {
        self.run(PeerUnderTest::Runtime, harness).await
    }

    /// Run this wire test against an Agent Service implementation.
    pub async fn run_server<H>(&self, harness: &mut H) -> Result<(), WireTestFailure<H::Error>>
    where
        H: WireHarness,
    {
        self.run(PeerUnderTest::Server, harness).await
    }

    /// Run this wire test against the selected protocol peer.
    pub async fn run<H>(
        &self,
        peer: PeerUnderTest,
        harness: &mut H,
    ) -> Result<(), WireTestFailure<H::Error>>
    where
        H: WireHarness,
    {
        for (step, expected) in self.messages.iter().enumerate() {
            if peer.receives(expected.direction) {
                harness
                    .send_to_subject(expected.message.clone())
                    .await
                    .map_err(|source| WireTestFailure::Send {
                        step,
                        direction: expected.direction,
                        source,
                    })?;
                continue;
            }

            let actual = harness.receive_from_subject().await.map_err(|source| {
                WireTestFailure::Receive {
                    step,
                    direction: expected.direction,
                    source,
                }
            })?;

            if actual != expected.message {
                return Err(WireTestFailure::Mismatch {
                    step,
                    direction: expected.direction,
                    expected: expected.message.clone(),
                    actual,
                });
            }
        }

        Ok(())
    }
}

impl FromIterator<WireMessage> for WireTest {
    fn from_iter<T: IntoIterator<Item = WireMessage>>(messages: T) -> Self {
        Self::new(messages)
    }
}

/// A failure while running a direction-labelled wire test.
#[derive(Debug)]
pub enum WireTestFailure<E> {
    /// An inbound wire message could not be delivered to the subject.
    Send {
        /// Zero-based wire-test step.
        step: usize,
        /// Intended wire destination.
        direction: Direction,
        /// Harness error.
        source: E,
    },
    /// The next outbound wire message could not be received from the subject.
    Receive {
        /// Zero-based wire-test step.
        step: usize,
        /// Expected wire destination.
        direction: Direction,
        /// Harness error.
        source: E,
    },
    /// The subject emitted a different JSON value than the wire test expected.
    Mismatch {
        /// Zero-based wire-test step.
        step: usize,
        /// Expected wire destination.
        direction: Direction,
        /// Expected complete JSON message.
        expected: Value,
        /// Actual complete JSON message.
        actual: Value,
    },
}

impl<E> Display for WireTestFailure<E>
where
    E: Display,
{
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Send {
                step,
                direction,
                source,
            } => write!(
                formatter,
                "wire step {}: failed to send JSON message to {direction}: {source}",
                step + 1
            ),
            Self::Receive {
                step,
                direction,
                source,
            } => write!(
                formatter,
                "wire step {}: failed to receive JSON message to {direction}: {source}",
                step + 1
            ),
            Self::Mismatch {
                step,
                direction,
                expected,
                actual,
            } => write!(
                formatter,
                "wire step {}: JSON message to {direction} did not match\nexpected: {expected}\n  actual: {actual}",
                step + 1
            ),
        }
    }
}

impl<E> Error for WireTestFailure<E>
where
    E: Error + 'static,
{
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Send { source, .. } | Self::Receive { source, .. } => Some(source),
            Self::Mismatch { .. } => None,
        }
    }
}
