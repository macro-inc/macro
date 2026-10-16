//! Wire types for the gateway's inbound fan-out.
//!
//! Every gateway instance republishes its entire client websocket traffic —
//! connection lifecycle and every frame, text or binary, unparsed — to Redis
//! on [`INBOUND_CHANNEL`]. Consumer services subscribe and pick out what they
//! care about (the sync tier consumes binary frames; others may follow). A
//! consumer replies to a specific connection on that gateway instance's
//! [`outbound_channel`].
//!
//! Encoding on both channels is `postcard`; Redis pub/sub is binary-safe.
//!
//! Delivery is fire-and-forget. Consumers detect a dead gateway instance by
//! its [`FromGateway::Heartbeat`] going quiet, not by any delivery guarantee.
//! In particular, a crashed gateway never publishes its connections'
//! [`FromGateway::Disconnected`] — consumers must treat heartbeat silence as
//! the disconnect of everything that instance held, and must tolerate
//! duplicate or missing lifecycle messages generally.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Boot-unique id of a gateway instance. Minted fresh at gateway startup, so
/// a restarted instance is a new id and the old one simply goes quiet.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GatewayId(pub String);

impl fmt::Display for GatewayId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// For string literals in tests and constructors at the wire boundary.
impl From<&str> for GatewayId {
    fn from(id: &str) -> Self {
        Self(id.to_string())
    }
}

/// Gateway-local id of one websocket connection. Only meaningful together
/// with the [`GatewayId`] that minted it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConnId(pub String);

impl fmt::Display for ConnId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// For string literals in tests and constructors at the wire boundary.
impl From<&str> for ConnId {
    fn from(id: &str) -> Self {
        Self(id.to_string())
    }
}

/// Channel every gateway instance publishes its inbound traffic to.
pub const INBOUND_CHANNEL: &str = "connection_gateway.fanout.inbound";

/// Interval between [`FromGateway::Heartbeat`] messages.
pub const HEARTBEAT_INTERVAL_SECS: u64 = 5;

/// The per-instance channel consumers reply on. `gateway` is minted fresh at
/// gateway boot, so a restarted instance is a new peer and the old id simply
/// goes quiet.
pub fn outbound_channel(gateway: &GatewayId) -> String {
    format!("connection_gateway.fanout.outbound.{gateway}")
}

/// Everything a gateway instance publishes on [`INBOUND_CHANNEL`].
#[derive(Debug, Serialize, Deserialize)]
pub enum FromGateway {
    /// A websocket connection was accepted and its user authenticated.
    Connected {
        /// Boot-unique id of the publishing gateway instance.
        gateway: GatewayId,
        /// Gateway-local id of the websocket connection.
        conn: ConnId,
        /// User the gateway authenticated at the socket edge.
        user_id: MacroUserIdStr<'static>,
    },
    /// One client frame, in per-connection order, unparsed.
    Frame {
        /// Boot-unique id of the publishing gateway instance.
        gateway: GatewayId,
        /// Gateway-local id of the websocket connection.
        conn: ConnId,
        /// Whether the frame was a text websocket message (else binary).
        text: bool,
        /// The client's bytes, unparsed.
        payload: Vec<u8>,
    },
    /// The websocket connection closed.
    Disconnected {
        /// Boot-unique id of the publishing gateway instance.
        gateway: GatewayId,
        /// Gateway-local id of the websocket connection.
        conn: ConnId,
    },
    /// Liveness beacon, published every [`HEARTBEAT_INTERVAL_SECS`].
    /// Consumers should drop all state for a gateway id that goes quiet.
    Heartbeat {
        /// Boot-unique id of the publishing gateway instance.
        gateway: GatewayId,
    },
}

/// Messages a consumer publishes on a gateway's [`outbound_channel`].
#[derive(Debug, Serialize, Deserialize)]
pub enum ToGateway {
    /// Deliver a frame to a connection's websocket.
    Frame {
        /// Gateway-local id of the target websocket connection.
        conn: ConnId,
        /// Whether to send as a text websocket message (else binary).
        text: bool,
        /// The bytes to send, unparsed.
        payload: Vec<u8>,
    },
    /// Close a connection's websocket.
    Close {
        /// Gateway-local id of the target websocket connection.
        conn: ConnId,
        /// Websocket close code to send.
        code: u16,
    },
}
