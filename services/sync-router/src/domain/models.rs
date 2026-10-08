//! Core types shared across the router.

pub use connection_gateway_models::fanout::{ConnId, GatewayId};

/// A client connection, globally identified by the gateway instance that owns
/// its socket plus that gateway's local connection id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionId {
    /// Boot-unique id of the gateway instance holding the socket.
    pub gateway: GatewayId,
    /// Gateway-local websocket connection id.
    pub conn: ConnId,
}

/// A document id, as it appears in envelope frames and downstream URLs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DocId(pub String);

impl DocId {
    /// Borrow the raw id.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Events from the gateway edge, already filtered to what the router handles
/// (text frames never reach it).
#[derive(Debug)]
pub enum EdgeEvent {
    /// A client sent a binary frame: a serialized `ToRouter` envelope.
    Frame {
        /// The sending connection.
        conn: ConnectionId,
        /// The raw envelope bytes.
        payload: Vec<u8>,
    },
    /// A client connection closed.
    Disconnected {
        /// The closed connection.
        conn: ConnectionId,
    },
    /// A gateway instance stopped heartbeating: every connection it held is gone.
    GatewayLost {
        /// The dead gateway instance's boot-unique id.
        gateway: GatewayId,
    },
}

/// Everything the router loop reacts to.
#[derive(Debug)]
pub enum Event {
    /// An event from the gateway edge.
    Edge(EdgeEvent),
    /// A downstream connection died (upstream close or dial failure). The
    /// client was already sent `RouterDocClosed` / `RouterSubscribeFailed` by
    /// the downstream pump; this only cleans up the route.
    DownstreamClosed {
        /// The connection whose downstream died.
        conn: ConnectionId,
        /// The document it was for.
        doc: DocId,
        /// Which incarnation of the route died. A stale close (e.g. a slow
        /// dial failing after the client already re-subscribed) must not tear
        /// down the replacement route.
        epoch: u64,
    },
}
