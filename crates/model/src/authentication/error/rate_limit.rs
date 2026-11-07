pub use model_error_response::GenericErrorResponse;

#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum RateLimitError {
    #[error("too many requests")]
    TooManyRequests,
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
}

impl From<anyhow::Error> for RateLimitError {
    fn from(err: anyhow::Error) -> Self {
        RateLimitError::Generic(GenericErrorResponse::from(err))
    }
}
