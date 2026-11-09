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
    /// FusionAuth's OAuth2 token endpoint refused the request with an
    /// RFC 6749 section 5.2 error, such as `invalid_grant` for a refresh
    /// token it no longer holds.
    #[error("{SERVICE_NAME} refused the OAuth2 token request: {0}")]
    OAuth2TokenRefused(OAuth2TokenError),
    /// The provider refused to refresh this user's grant by policy, such as a
    /// Google Workspace admin not approving Macro. Retrying will not help
    /// until the user's organization allows access.
    #[error("access blocked by the user's organization: {reason}")]
    GrantBlocked {
        /// The provider's OAuth error code.
        reason: GrantBlockReason,
    },
}

/// An RFC 6749 section 5.2 error from FusionAuth's `/oauth2/token`. Carries no
/// credential, so it is safe to log.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OAuth2TokenError {
    /// The RFC 6749 error code, e.g. `invalid_grant` or `invalid_client`.
    pub error: String,
    /// FusionAuth's finer-grained cause, e.g. `refresh_token_not_found`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    /// FusionAuth's human-readable description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
}

impl OAuth2TokenError {
    /// Whether the grant itself (code or refresh token) was refused as
    /// invalid, expired, or revoked. Only the user signing in again fixes
    /// that; every other code means the request or our client is wrong.
    /// FusionAuth answers a dead authorization code with `invalid_request` and
    /// the reason `auth_code_not_found`, not with `invalid_grant`.
    pub fn is_invalid_grant(&self) -> bool {
        self.error == "invalid_grant" || self.error_reason.as_deref() == Some("auth_code_not_found")
    }
}

impl std::fmt::Display for OAuth2TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.error)?;
        if let Some(reason) = &self.error_reason {
            write!(f, " ({reason})")?;
        }
        if let Some(description) = &self.error_description {
            write!(f, ": {description}")?;
        }
        Ok(())
    }
}

/// Google OAuth error codes for a grant the user's organization does not let
/// Macro use, such as a Workspace admin who has not approved the app. Only
/// that organization can lift them. `invalid_client` and `unauthorized_client`
/// are deliberately absent: they mean Macro's own OAuth client is broken.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, strum::EnumString, strum::Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GrantBlockReason {
    /// A Workspace admin has not reviewed and configured access for Macro.
    AccessNotConfigured,
    /// A Workspace admin policy forbids the requested scopes.
    AdminPolicyEnforced,
    /// The user or their organization denied access.
    AccessDenied,
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
    /// outages and throttling become [`Self::Upstream`], and anything else
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
        tracing::error!(status=%status, body=%body, "unexpected response from fusionauth");
        Self::Generic(GenericErrorResponse { message: body })
    }
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
