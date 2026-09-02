pub mod websocket;

use bebop::Record;
use worker::WebSocket;

use crate::{domain::ports::SyncServiceError, error::ResultExt, generated::schema::FromRemote};

pub struct RemoteSocket {
    ws: WebSocket,
    id: String,
}

impl RemoteSocket {
    pub fn new(ws: WebSocket, id: String) -> Self {
        Self { ws, id }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn send<'m>(&self, msg: FromRemote<'m>) -> Result<(), SyncServiceError> {
        let mut buf = Vec::new();
        msg.serialize(&mut buf)
            .context("failed to serialize message")?;
        self.ws
            .send_with_bytes(&buf)
            .context("failed to send message")?;
        Ok(())
    }
}
