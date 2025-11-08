#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum DcsClientError {
    #[error("unauthorized: {details}")]
    Unauthorized { details: String },
    #[error("access denied: {details}")]
    Forbidden { details: String },
    #[error("not found: {details}")]
    NotFound { details: String },
    #[error("internal server error: {details}")]
    InternalServerError { details: String },
    #[error("unable to build request: {details}")]
    RequestBuildError { details: String },
    #[error("{message}")]
    Generic { message: String },
}

impl From<anyhow::Error> for DcsClientError {
    fn from(err: anyhow::Error) -> Self {
        DcsClientError::Generic {
            message: err.to_string(),
        }
    }
}
