use sync_server_core::domain::socket::WebSocketId;
use worker::{Error, Result};

pub fn get_ws_id_from_tags(tags: &[String]) -> Result<String> {
    WebSocketId::from_tags(tags)
        .map(|id| id.to_string())
        .map_err(|error| Error::from(error.to_string()))
}
