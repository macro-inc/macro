use thiserror::Error;

#[derive(Error, Debug)]
pub enum GmailError {
    #[error("API Rate Limit Exceeded (429)")]
    RateLimitExceeded,

    #[error("Unauthorized: The access token is invalid or expired (401)")]
    Unauthorized,

    #[error("HTTP Request Error: {0}")]
    HttpRequest(String),

    #[error("API Error")]
    ApiError(String),

    #[error("Multipart Parsing Error: {0}")]
    MultipartParse(String),

    #[error("Failed to read response body: {0}")]
    BodyReadError(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal Error: {0}")]
    GenericError(String),
}
