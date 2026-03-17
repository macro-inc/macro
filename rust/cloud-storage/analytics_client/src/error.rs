//! Error types for the analytics client.

/// Errors that can occur when interacting with analytics providers.
#[derive(Debug, thiserror::Error)]
pub enum AnalyticsError {
    /// HTTP request failed
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    /// JSON serialization/deserialization failed
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Provider returned an error response
    #[error("Provider error: {status} - {message}")]
    ProviderError {
        /// HTTP status code
        status: u16,
        /// Error message from the provider
        message: String,
    },

    /// Configuration error
    #[error("Configuration error: {0}")]
    Configuration(String),
}
