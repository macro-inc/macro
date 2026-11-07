pub use model_error_response::GenericErrorResponse;

#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum DssClientError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("internal server error: {details}")]
    InternalServerError { details: String },
    #[error("unable to build request: {details}")]
    RequestBuildError { details: String },
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
}

impl From<anyhow::Error> for DssClientError {
    fn from(err: anyhow::Error) -> Self {
        DssClientError::Generic(GenericErrorResponse::from(err))
    }
}
