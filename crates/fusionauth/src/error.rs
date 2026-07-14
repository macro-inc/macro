#[derive(thiserror::Error, Debug, serde::Serialize)]
#[serde(tag = "type")]
/// Errors that can occur when interacting with the FusionAuth API.
pub enum FusionAuthClientError {
    /// The user does not exist in FusionAuth.
    #[error("user does not exist")]
    UserDoesNotExist,
    /// The user's email has not been verified.
    #[error("user not verified")]
    UserNotVerified,
    /// The user is not registered to the application.
    #[error("user not registered to application")]
    UserNotRegistered,
    /// The user is already registered to the application.
    #[error("user already registered")]
    UserAlreadyRegistered,
    /// A user with this email already exists.
    #[error("user already exists")]
    UserAlreadyExists,
    /// The Google identity is already linked to this FusionAuth user.
    #[error("identity provider link already exists")]
    IdentityProviderLinkAlreadyExists,
    /// No identity provider was found.
    #[error("no identity provider found")]
    NoIdentityProviderFound,
    /// The provided code was incorrect.
    #[error("incorrect code")]
    IncorrectCode,
    /// The refresh token was not found or has expired.
    #[error("refresh token was not found or has expired")]
    InvalidRefreshToken,
    /// A generic error occurred.
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
    /// The grant is invalid - user may have revoked access.
    #[error("Invalid grant - user may have revoked access")]
    InvalidGrant,
}

/// A generic error response containing a message.
#[derive(serde::Serialize, Debug)]
pub struct GenericErrorResponse {
    /// The error message.
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
