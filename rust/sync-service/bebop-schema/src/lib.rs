mod generated;
pub use generated::*;

impl std::fmt::Display for FromPeer<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let m = match self {
            FromPeer::Unknown => "Unknown",
            FromPeer::PeerUpdate { .. } => "PeerUpdate",
            FromPeer::PeerAwareness { .. } => "PeerAwareness",
            FromPeer::PeerRequestSince { .. } => "PeerRequestSince",
            FromPeer::PeerRequestSnapshot {} => "PeerRequestSnapshot",
            FromPeer::PeerRegisterId { .. } => "PeerRegisterId",
        };
        write!(f, "{m}")
    }
}
