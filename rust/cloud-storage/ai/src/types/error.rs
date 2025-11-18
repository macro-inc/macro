use thiserror::Error;

pub type Result<T> = std::result::Result<T, AiError>;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("Context is too large for current model")]
    ContextWindowExceeded,
    #[error("Unknown error")]
    Generic(anyhow::Error),
}

impl From<anyhow::Error> for AiError {
    fn from(value: anyhow::Error) -> Self {
        Self::Generic(value)
    }
}

impl From<serde_json::Error> for AiError {
    fn from(value: serde_json::Error) -> Self {
        Self::Generic(value.into())
    }
}
