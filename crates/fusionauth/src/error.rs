use upstream_error::{UpstreamError, UpstreamFailure};

#[cfg(test)]
mod test;

/// FusionAuth's user-facing name in error messages. Users know it as the
/// place they sign in, not as FusionAuth.
pub const SERVICE_NAME: &str = "The sign-in service";

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
    /// Microsoft OAuth credentials were not configured.
    #[error("Microsoft OAuth not configured")]
    MicrosoftOAuthNotConfigured,
    /// FusionAuth, or a provider this crate calls directly (Google), was
    /// unreachable, overloaded, or answered with something unusable. Not the
    /// caller's fault; retry later.
    #[error("{service} {failure}")]
    Upstream {
        /// The failing service's user-facing name.
        #[serde(skip)]
        service: &'static str,
        /// What went wrong.
        #[serde(skip)]
        failure: UpstreamFailure,
    },
    /// A generic error occurred.
    #[error("an unknown error occurred")]
    Generic(GenericErrorResponse),
    /// The grant is invalid - user may have revoked access.
    #[error("Invalid grant - user may have revoked access")]
    InvalidGrant,
}

impl FusionAuthClientError {
    /// The failure to answer with when FusionAuth itself failed, for callers
    /// that map errors to HTTP responses.
    pub fn upstream(&self) -> Option<UpstreamError> {
        match self {
            Self::Upstream { service, failure } => Some(UpstreamError {
                service,
                failure: *failure,
            }),
            _ => None,
        }
    }

    /// A request that got no usable answer: FusionAuth was unreachable, the
    /// connection dropped, or the body could not be decoded.
    pub(crate) fn transport(error: reqwest::Error) -> Self {
        Self::provider_transport(SERVICE_NAME, error)
    }

    /// [`Self::transport`] for a request to another provider.
    pub(crate) fn provider_transport(service: &'static str, error: reqwest::Error) -> Self {
        tracing::error!(error=?error, service, "request failed");
        Self::Upstream {
            service,
            failure: UpstreamFailure::from_transport(&error),
        }
    }

    /// Classifies a response with a status the call did not expect: FusionAuth
    /// outages and throttling become [`Self::Upstream`], a `userId` FusionAuth
    /// does not know becomes [`Self::UserDoesNotExist`], and anything else
    /// stays [`Self::Generic`] with the body.
    pub(crate) async fn unexpected_response(response: reqwest::Response) -> Self {
        let status = response.status();
        let headers = response.headers().clone();
        match response.text().await {
            Ok(body) => Self::unexpected(status, &headers, body),
            Err(error) => Self::transport(error),
        }
    }

    /// [`Self::unexpected_response`] for a call that already read the body.
    pub(crate) fn unexpected(
        status: reqwest::StatusCode,
        headers: &reqwest::header::HeaderMap,
        body: String,
    ) -> Self {
        if let Some(failure) = UpstreamFailure::from_status(status, headers) {
            tracing::error!(status=%status, body=%body, "fusionauth is failing");
            return Self::Upstream {
                service: SERVICE_NAME,
                failure,
            };
        }
        if names_unknown_user(&body) {
            tracing::warn!(status=%status, body=%body, "fusionauth does not know the user");
            return Self::UserDoesNotExist;
        }
        tracing::error!(status=%status, body=%body, "unexpected response from fusionauth");
        Self::Generic(GenericErrorResponse { message: body })
    }
}

/// FusionAuth answers a `userId` it has no user for with a 400 whose
/// `fieldErrors.userId` carries `[invalid]userId`.
/// See https://fusionauth.io/docs/apis/errors
fn names_unknown_user(body: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct ErrorBody {
        #[serde(default, rename = "fieldErrors")]
        field_errors: std::collections::HashMap<String, Vec<FieldError>>,
    }
    #[derive(serde::Deserialize)]
    struct FieldError {
        code: String,
    }

    serde_json::from_str::<ErrorBody>(body).is_ok_and(|body| {
        body.field_errors
            .get("userId")
            .is_some_and(|errors| errors.iter().any(|error| error.code == "[invalid]userId"))
    })
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
