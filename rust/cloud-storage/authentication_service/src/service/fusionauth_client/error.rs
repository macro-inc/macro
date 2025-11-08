#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
pub enum FusionAuthClientError {
    #[error("user does not exist")]
    UserDoesNotExist,
    #[error("user not verified")]
    UserNotVerified,
    #[error("user not registered to application")]
    UserNotRegistered,
    #[error("user already registered")]
    UserAlreadyRegistered,
    #[error("user already exists")]
    UserAlreadyExists,
    #[error("no identity provider found")]
    NoIdentityProviderFound,
    #[error("incorrect code")]
    IncorrectCode,
    #[error("refresh token was not found or has expired")]
    InvalidRefreshToken,
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

impl From<anyhow::Error> for FusionAuthClientError {
    fn from(err: anyhow::Error) -> Self {
        FusionAuthClientError::Generic(GenericErrorResponse::from(err))
    }
}
