use opensearch::{
    Error,
    http::{StatusCode, response::Response},
};

#[derive(thiserror::Error, Debug, serde::Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum OpensearchClientError {
    #[error("error deserializing response body. method: {method:?} details: {details}")]
    DeserializationFailed {
        details: String,
        method: Option<String>,
    },
    #[error("unable to serialize into json. method: {method:?} details: {details}")]
    SerializationFailed {
        details: String,
        method: Option<String>,
    },
    #[error("a network error occurred. status_code: {status_code} message: {message}")]
    NetworkError { status_code: u16, message: String },

    #[error("invalid match type. match_type: {match_type}")]
    InvalidMatchType { match_type: String },

    #[error("validation failed: {details}")]
    ValidationFailed { details: String },

    #[error("no terms provided")]
    NoTermsProvided,

    #[error("an unknown error occurred. method: {method:?} details: {details}")]
    Unknown {
        details: String,
        method: Option<String>,
    },
}

impl From<anyhow::Error> for OpensearchClientError {
    fn from(err: anyhow::Error) -> Self {
        OpensearchClientError::Unknown {
            details: err.to_string(),
            method: None,
        }
    }
}

pub trait ResponseExt {
    #[allow(async_fn_in_trait)]
    async fn map_client_error(self) -> Result<Response, OpensearchClientError>;
}

impl ResponseExt for Response {
    async fn map_client_error(self) -> Result<Response, OpensearchClientError> {
        match self.status_code() {
            StatusCode::OK | StatusCode::CREATED | StatusCode::ACCEPTED => Ok(self),
            _ => Err(OpensearchClientError::NetworkError {
                status_code: self.status_code().as_u16(),
                message: self.text().await.unwrap_or_default(),
            }),
        }
    }
}

impl ResponseExt for Result<Response, Error> {
    async fn map_client_error(self) -> Result<Response, OpensearchClientError> {
        match self {
            Ok(response) => response.map_client_error().await,
            Err(e) => Err(OpensearchClientError::Unknown {
                details: e.to_string(),
                method: None,
            }),
        }
    }
}
