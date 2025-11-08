use anyhow::anyhow;
use async_trait::async_trait;
use reqwest::StatusCode;
use reqwest::{Error, Response};

#[derive(thiserror::Error, Debug)]
pub enum ClientError {
    #[error("request error: {0}")]
    Generic(#[from] anyhow::Error),
    #[error("network error: {status_code} {message}")]
    NetworkError { status_code: u16, message: String },
}

#[async_trait]
pub trait ResponseExt {
    async fn map_client_error(self) -> Result<Response, ClientError>;
}

#[async_trait]
impl ResponseExt for Response {
    async fn map_client_error(self) -> Result<Response, ClientError> {
        match self.status() {
            StatusCode::OK | StatusCode::CREATED | StatusCode::ACCEPTED => Ok(self),
            _ => Err(ClientError::NetworkError {
                status_code: self.status().as_u16(),
                message: self.text().await.unwrap_or_default(),
            }),
        }
    }
}

#[async_trait]
impl ResponseExt for Result<Response, Error> {
    async fn map_client_error(self) -> Result<Response, ClientError> {
        match self {
            Ok(response) => response.map_client_error().await,
            Err(e) => Err(ClientError::Generic(anyhow!(e.to_string()))),
        }
    }
}
