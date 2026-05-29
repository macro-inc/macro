#![deny(missing_docs)]

//! Thin HTTP client for the document cognition service (DCS).
//!
//! Currently exposes the internal "run the agent loop and return text" endpoint
//! used to power Macro AI replies in channels.

use serde::{Deserialize, Serialize};

/// Header carrying the internal service auth key. Mirrors
/// `macro_middleware::auth::internal_access`.
const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";

/// Errors returned by the document cognition service client.
#[derive(Debug, thiserror::Error)]
pub enum DcsClientError {
    /// The HTTP request failed to send.
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    /// The service returned a non-success status.
    #[error("document cognition service returned {status}: {body}")]
    Status {
        /// HTTP status code.
        status: u16,
        /// Response body.
        body: String,
    },
}

#[derive(Debug, Serialize)]
struct ChannelAgentRequest {
    user_id: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct ChannelAgentResponse {
    text: String,
}

/// HTTP client for the document cognition service.
#[derive(Clone)]
pub struct DocumentCognitionServiceClient {
    url: String,
    internal_auth_key: String,
    client: reqwest::Client,
}

impl DocumentCognitionServiceClient {
    /// Create a new client targeting `url` (the DCS base URL).
    pub fn new(url: String, internal_auth_key: String) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            internal_auth_key,
            client: reqwest::Client::new(),
        }
    }

    /// Run the agent loop on behalf of `user_id` with `prompt` and return the
    /// final assistant text.
    #[tracing::instrument(skip(self, prompt), fields(user_id = %user_id), err)]
    pub async fn channel_respond(
        &self,
        user_id: &str,
        prompt: String,
    ) -> Result<String, DcsClientError> {
        let response = self
            .client
            .post(format!("{}/internal/agent/channel-respond", self.url))
            .header(INTERNAL_API_KEY_HEADER, &self.internal_auth_key)
            .json(&ChannelAgentRequest {
                user_id: user_id.to_string(),
                prompt,
            })
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(DcsClientError::Status { status, body });
        }

        let parsed: ChannelAgentResponse = response.json().await?;
        Ok(parsed.text)
    }
}
