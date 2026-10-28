//! Core types shared across the router.

/// A host-generated client connection id. Each socket has its own router.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionId(pub String);

/// A document id, as it appears in envelope frames and downstream URLs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DocId(pub String);

impl DocId {
    /// Borrow the raw id.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Events from the socket edge, already filtered to what the router handles
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
}

/// Everything the router loop reacts to.
#[derive(Debug)]
pub enum Event {
    /// An event from the socket edge.
    Edge(EdgeEvent),
    /// A downstream connection died (upstream close or dial failure). The
    /// router checks the incarnation before notifying the client, so an old
    /// pump cannot close a replacement virtual socket.
    DownstreamClosed {
        /// The connection whose downstream died.
        conn: ConnectionId,
        /// The document it was for.
        doc: DocId,
        /// Which incarnation of the route died. A stale close (e.g. a slow
        /// dial failing after the client already re-subscribed) must not tear
        /// down the replacement route.
        epoch: u64,
        /// Whether dialing failed or an established connection ended.
        failure: DownstreamFailure,
    },
}

/// Coarse downstream failure safe to expose to clients.
#[derive(Debug)]
pub enum DownstreamFailure {
    /// Authentication, connection establishment, or its timeout failed.
    DialFailed,
    /// An established upstream connection ended.
    Closed(&'static str),
}
