use bebop::Record;
use worker::{Result, WebSocket};

use crate::error::ResultExt;
use sync_protocol::framing;

/// A single peer websocket, but abstracted so that we can wrap our own transport layer.
pub(crate) struct Socket {
    ws: WebSocket,
}

/// Sockets are equal when they wrap the same peer websocket (used to skip the
/// sender in broadcasts). Reassembly buffers belong to RoomMemory.
impl PartialEq for Socket {
    fn eq(&self, other: &Self) -> bool {
        self.ws == other.ws
    }
}
impl Eq for Socket {}

impl Socket {
    pub(crate) fn new(ws: WebSocket) -> Self {
        Self { ws }
    }

    /// Serialize and send one message to this peer, split into wire frames so it
    /// stays under the durable object's max outbound websocket message size.
    pub(crate) fn send<'m, T: Record<'m>>(&self, msg: T) -> Result<()> {
        let mut buf = Vec::new();
        msg.serialize(&mut buf)
            .context("failed to serialize message")?;
        for frame in framing::into_frames(&buf, framing::MAX_CHUNK_SIZE) {
            self.ws
                .send_with_bytes(&frame)
                .context("failed to send frame")?;
        }
        Ok(())
    }
}
