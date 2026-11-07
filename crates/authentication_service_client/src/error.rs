pub use model_error_response::GenericErrorResponse;

#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum AuthServiceClientError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("internal server error: {details}")]
    InternalServerError { details: String },
    #[error("unable to build request: {details}")]
    RequestBuildError { details: String },
    #[error("{}", .0.message)]
    Generic(GenericErrorResponse),
}

impl From<anyhow::Error> for AuthServiceClientError {
    fn from(err: anyhow::Error) -> Self {
        AuthServiceClientError::Generic(GenericErrorResponse::from(err))
    }
}
