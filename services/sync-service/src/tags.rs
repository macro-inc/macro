use sync_server_core::domain::socket::WebSocketId;
use uuid::Uuid;
use worker::{Error, Result};

pub fn new_ws_id() -> String {
    WebSocketId::new(Uuid::new_v4()).to_string()
}

pub fn get_ws_id_from_tags(tags: &[String]) -> Result<String> {
    WebSocketId::from_tags(tags)
        .map(|id| id.to_string())
        .map_err(|error| Error::from(error.to_string()))
}
