use crate::types::stream_response::StreamError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AnthropicError {
    /// An error sent by anthropic
    #[error("Error returned from stream")]
    StreamError(StreamError),
    /// Stream closed unexpectedly
    #[error("stream closed unexpectedly")]
    StreamClosed(String),
    /// bad json returned from stream
    #[error("Invalid json returned from stream")]
    JsonDeserialize(serde_json::Error),
    /// error from reqwest
    #[error("http error")]
    Reqwest(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, AnthropicError>;
