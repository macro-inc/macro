use std::fmt;

use thiserror::Error;

/// An opaque bearer token used to authorize provider API requests.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken(String);

impl AccessToken {
    /// Wraps an access token without validating provider-specific syntax.
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }

    /// Borrows the token for an outbound provider adapter.
    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    /// Consumes this value and returns the token string.
    pub fn into_secret(self) -> String {
        self.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AccessToken([REDACTED])")
    }
}

impl From<String> for AccessToken {
    fn from(token: String) -> Self {
        Self::new(token)
    }
}

/// Controls whether a token may come from a cache or must be refreshed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TokenFreshness {
    /// A valid cached token may be returned.
    #[default]
    Cached,
    /// The provider grant must be checked by fetching a fresh token.
    Fresh,
}

/// A provider-neutral token acquisition failure.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum TokenError {
    /// The grant is absent or revoked and the user must reconnect it.
    #[error("email provider authorization is required")]
    ReauthRequired,
    /// Token acquisition failed temporarily and may be retried.
    #[error("access token acquisition failed temporarily: {message}")]
    Transient {
        /// A sanitized diagnostic suitable for logs.
        message: String,
    },
    /// Token acquisition failed permanently for a reason other than reauthorization.
    #[error("access token acquisition failed: {message}")]
    Permanent {
        /// A sanitized diagnostic suitable for logs.
        message: String,
    },
}

#[cfg(test)]
mod test;
