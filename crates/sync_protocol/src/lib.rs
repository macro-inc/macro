//! Shared wire types, framing and time units for document collaboration.
#![deny(missing_docs)]

#[rustfmt::skip]
#[expect(missing_docs, reason = "The pinned Bebop generator does not document every wire field")]
mod generated;

/// WebSocket frame encoding and reassembly.
pub mod framing;
/// Clock-injected, wire-compatible ephemeral presence.
#[cfg(feature = "presence")]
pub mod presence;
/// Explicit wall-clock units shared by sync clients and servers.
pub mod time;

/// Application-level heartbeat request.
pub const PING: &str = "ping";
/// Application-level heartbeat response.
pub const PONG: &str = "pong";
pub use generated::*;

impl std::fmt::Display for FromPeer<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let m = match self {
            FromPeer::Unknown => "Unknown",
            FromPeer::PeerUpdate { .. } => "PeerUpdate",
            FromPeer::PeerCommentUpdate { .. } => "PeerCommentUpdate",
            FromPeer::PeerAwareness { .. } => "PeerAwareness",
            FromPeer::PeerRequestSince { .. } => "PeerRequestSince",
            FromPeer::PeerRequestSnapshot {} => "PeerRequestSnapshot",
            FromPeer::PeerRegisterId { .. } => "PeerRegisterId",
        };
        write!(f, "{m}")
    }
}

#[cfg(test)]
mod test;
