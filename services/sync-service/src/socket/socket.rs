use bebop::Record;
use worker::{Result, WebSocket};

use crate::error::ResultExt;

/// A single peer websocket, but abstracted so that we can wrap our own transport layer.
#[derive(PartialEq, Eq)]
pub(crate) struct Socket {
    ws: WebSocket,
}

impl Socket {
    pub(crate) fn new(ws: WebSocket) -> Self {
        Self { ws }
    }

    /// The underlying peer websocket.
    pub(crate) fn websocket(&self) -> &WebSocket {
        &self.ws
    }

    /// Serialize and send one message to this peer.
    pub(crate) fn send<'m, T: Record<'m>>(&self, msg: T) -> Result<()> {
        let mut buf = Vec::new();
        msg.serialize(&mut buf).context("failed to serialize message")?;
        self.ws
            .send_with_bytes(&buf)
            .context("failed to send message")?;
        Ok(())
    }
}
