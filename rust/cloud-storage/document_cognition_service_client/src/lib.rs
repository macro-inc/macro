pub mod chat;
pub(crate) mod constants;
pub mod error;
pub mod notification;

use constants::INTERNAL_AUTH_HEADER_KEY;
use error::DcsClientError;
use serde::de::DeserializeOwned;

pub struct DocumentCognitionServiceClient {
    url: String,
    client: reqwest::Client,
}

impl DocumentCognitionServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }

    /// Common helper method for handling DCS API responses
    pub(crate) async fn handle_response<T: DeserializeOwned>(
        res: reqwest::Response,
        operation: &str,
    ) -> Result<T, DcsClientError> {
        match res.status() {
            reqwest::StatusCode::OK => {
                tracing::trace!("{} successful", operation);
                let result = res.json::<T>().await.map_err(|e| DcsClientError::Generic {
                    message: e.to_string(),
                })?;
                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => {
                tracing::error!("unauthorized for {}", operation);
                let error_details = Self::extract_error_message(res).await;
                Err(DcsClientError::Unauthorized {
                    details: error_details,
                })
            }
            reqwest::StatusCode::FORBIDDEN => {
                tracing::error!("forbidden for {}", operation);
                let error_details = Self::extract_error_message(res).await;
                Err(DcsClientError::Forbidden {
                    details: error_details,
                })
            }
            reqwest::StatusCode::NOT_FOUND => {
                tracing::error!("not found for {}", operation);
                let error_details = Self::extract_error_message(res).await;
                Err(DcsClientError::NotFound {
                    details: error_details,
                })
            }
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!("internal server error for {}", operation);
                let error_details = Self::extract_error_message(res).await;
                Err(DcsClientError::InternalServerError {
                    details: error_details,
                })
            }
            _ => {
                tracing::error!("unexpected status {} for {}", res.status(), operation);
                let error_details = Self::extract_error_message(res).await;
                Err(DcsClientError::Generic {
                    message: error_details,
                })
            }
        }
    }

    async fn extract_error_message(res: reqwest::Response) -> String {
        // Try to parse as JSON error response first
        let text = match res.text().await {
            Ok(text) => text,
            Err(e) => return format!("Failed to read error response: {}", e),
        };

        // Try to parse as JSON and extract the error field
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&text)
            && let Some(error_msg) = json_value.get("error").and_then(|e| e.as_str())
        {
            return error_msg.to_string();
        }

        // Fallback to raw text response
        text
    }
}
