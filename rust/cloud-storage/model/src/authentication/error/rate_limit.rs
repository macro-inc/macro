#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum RateLimitError {
    #[error("too many requests")]
    TooManyRequests,
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
}

#[derive(serde::Serialize, Debug)]
pub struct GenericErrorResponse {
    pub message: String,
}

impl From<anyhow::Error> for GenericErrorResponse {
    fn from(err: anyhow::Error) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

impl From<anyhow::Error> for RateLimitError {
    fn from(err: anyhow::Error) -> Self {
        RateLimitError::Generic(GenericErrorResponse::from(err))
    }
}
