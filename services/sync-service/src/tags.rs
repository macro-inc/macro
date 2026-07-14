use uuid::Uuid;
use worker::{Error, Result};

const WS_ID_TAG: &str = "ws_id";

pub fn new_ws_id() -> String {
    let id = Uuid::new_v4().to_string();
    format!("{WS_ID_TAG}{id}")
}

pub fn get_ws_id_from_tags(tags: &[String]) -> Result<String> {
    let Some(tag) = tags.first() else {
        return Err(Error::from(format!(
            "websocket should only have exactly one tag! tags = {tags:?}"
        )));
    };
    if tag.starts_with(WS_ID_TAG) {
        Ok(tag.clone())
    } else {
        Err(Error::from(format!(
            "WebSocket tag has an unknown prefix: whole_tag = {tag} expected prefix = {WS_ID_TAG}"
        )))
    }
}
