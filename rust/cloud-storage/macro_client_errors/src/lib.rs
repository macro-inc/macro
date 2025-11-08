#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum MacroClientError {
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

impl From<anyhow::Error> for MacroClientError {
    fn from(err: anyhow::Error) -> Self {
        MacroClientError::Generic(GenericErrorResponse::from(err))
    }
}
