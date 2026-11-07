//! Stable identifiers attached to hibernatable runtime sockets.
use std::fmt;

const PREFIX: &str = "ws_id";

/// A socket tag preserving the runtime's exact stored representation.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WebSocketId(String);

/// A missing or unrecognized socket tag.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SocketTagError {
    /// The runtime supplied no tags.
    #[error("websocket should only have exactly one tag! tags = {0:?}")]
    Missing(Vec<String>),
    /// The first tag lacks the legacy prefix.
    #[error("WebSocket tag has an unknown prefix: whole_tag = {0} expected prefix = ws_id")]
    UnknownPrefix(String),
}

impl WebSocketId {
    /// Construct a tag from a UUID supplied by the adapter's entropy source.
    pub fn new(uuid: uuid_types::Uuid) -> Self {
        Self(format!("{PREFIX}{uuid}"))
    }

    /// Read the first tag, retaining the legacy prefix-only validation.
    pub fn from_tags(tags: &[String]) -> Result<Self, SocketTagError> {
        let Some(tag) = tags.first() else {
            return Err(SocketTagError::Missing(tags.to_vec()));
        };
        if lazy_regex::regex_is_match!(r"^ws_id", tag) {
            Ok(Self(tag.clone()))
        } else {
            Err(SocketTagError::UnknownPrefix(tag.clone()))
        }
    }

    /// The complete tag, including its prefix.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for WebSocketId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(test)]
mod test;
