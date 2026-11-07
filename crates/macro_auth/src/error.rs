pub use model_error_response::GenericErrorResponse;

#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum MacroAuthError {
    #[error("invalid Authorization header format")]
    InvalidAuthorizationHeaderFormat,
    #[error("no access token provided")]
    NoAccessTokenProvided,
    #[error("no refresh token provided")]
    NoRefreshTokenProvided,
    #[error("jwt validation failed: {details}")]
    JwtValidationFailed { details: String },
    #[error("jwt is expired")]
    JwtExpired,
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
}

impl From<anyhow::Error> for MacroAuthError {
    fn from(err: anyhow::Error) -> Self {
        MacroAuthError::Generic(GenericErrorResponse::from(err))
    }
}
