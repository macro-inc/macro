use reqwest::StatusCode;
use thiserror::Error;

use crate::{prelude::ApiError };

#[derive(Debug, Error)]
pub enum AnthropicError {
    /// An error sent by anthropic
    #[error("Error returned from stream")]
    StreamError(String),
    /// Stream closed unexpectedly
    #[error("Invalid json returned from stream")]
    JsonDeserialize(serde_json::Error),
    /// error from reqwest
    #[error("http error")]
    Reqwest(#[from] reqwest::Error),
    #[error("API returned a bad status code")]
    ApiError {
        api_error: ApiError,
        status_code: StatusCode
    }
}

pub type Result<T> = std::result::Result<T, AnthropicError>;
