use std::{collections::HashMap, sync::Arc};

use bebop::Record;
use worker::{Result, WebSocket};

use super::framing::{self, Reassembler};
use crate::{error::ResultExt, mutex::Mutex};

/// Per-connection inbound reassembly buffers, keyed by websocket id. Lives on the
/// durable object (shared via `Arc`) so partial messages persist across the
/// `websocket_message` events that deliver each frame.
pub(crate) type InboundBuffers = Arc<Mutex<HashMap<String, Reassembler>>>;

/// A single peer websocket, but abstracted so that we can wrap our own transport layer.
pub(crate) struct Socket {
    ws: WebSocket,
    inbound: InboundBuffers,
}

/// Sockets are equal when they wrap the same peer websocket; the shared inbound
/// buffer handle is not part of identity (used to skip the sender in broadcasts).
impl PartialEq for Socket {
    fn eq(&self, other: &Self) -> bool {
        self.ws == other.ws
    }
}
impl Eq for Socket {}

impl Socket {
    pub(crate) fn new(ws: WebSocket, inbound: InboundBuffers) -> Self {
        Self { ws, inbound }
    }

    /// The underlying peer websocket.
    pub(crate) fn websocket(&self) -> &WebSocket {
        &self.ws
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

    /// Feeds one inbound frame for the connection identified by `ws_id`. Returns
    /// the complete message once its final frame arrives, otherwise `None` while
    /// earlier frames are still buffering.
    pub(crate) fn receive(&self, ws_id: &str, frame: &[u8]) -> Result<Option<Vec<u8>>> {
        let mut inbound = self.inbound.lock("Socket::receive");
        let message = inbound.entry(ws_id.to_string()).or_default().push(frame)?;
        if message.is_some() {
            inbound.remove(ws_id);
        }
        Ok(message)
    }

    /// Discards any partially-buffered inbound message for a connection. Call
    /// when the connection closes so a dropped mid-message doesn't leak.
    pub(crate) fn forget(&self, ws_id: &str) {
        self.inbound.lock("Socket::forget").remove(ws_id);
    }
}
