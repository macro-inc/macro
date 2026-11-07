//! Shared Bebop wire types for document collaboration and sync routing.
#![deny(missing_docs)]

#[rustfmt::skip]
#[expect(missing_docs, reason = "The pinned Bebop generator does not document every wire field")]
mod generated;
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
