use serde::{Deserialize, Serialize};
use std::fmt;

/// Upstream OAuth access token.
#[derive(Clone, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AccessToken(String);

impl AccessToken {
    /// Returns the token as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for AccessToken {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<String> for AccessToken {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for AccessToken {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<AccessToken> for String {
    fn from(value: AccessToken) -> Self {
        value.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AccessToken([REDACTED])")
    }
}

/// Upstream OAuth refresh token.
#[derive(Clone, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RefreshToken(String);

impl RefreshToken {
    /// Returns the token as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for RefreshToken {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<String> for RefreshToken {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for RefreshToken {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<RefreshToken> for String {
    fn from(value: RefreshToken) -> Self {
        value.0
    }
}

impl fmt::Debug for RefreshToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RefreshToken([REDACTED])")
    }
}

/// A pending OAuth authorization flow initiated by the client.
#[derive(Clone)]
pub struct PendingAuthorization {
    /// PKCE S256 code challenge from the client.
    pub code_challenge: String,
    /// The client's original `state` parameter.
    pub client_state: String,
    /// Where to redirect back to the client with the authorization code.
    pub client_redirect_uri: String,
}

/// An authorization code issued by this broker and backed by an upstream token.
#[derive(Clone)]
pub struct IssuedAuthorizationCode {
    /// The access token obtained from the upstream provider.
    pub access_token: AccessToken,
    /// The refresh token obtained from the upstream provider.
    pub refresh_token: RefreshToken,
    /// The original PKCE code challenge, for verification at token exchange.
    pub code_challenge: String,
    /// The redirect URI from the authorization request, used for exact-match
    /// validation during token exchange.
    pub redirect_uri: String,
}

/// OAuth authorize request from the MCP client.
#[derive(Deserialize)]
pub struct AuthorizeRequest {
    /// Expected to be `code`.
    pub response_type: String,
    /// Dynamically registered client id.
    #[allow(dead_code)]
    pub client_id: String,
    /// Loopback callback URI owned by the MCP client.
    pub redirect_uri: String,
    /// Opaque state from the client.
    pub state: String,
    /// PKCE code challenge.
    pub code_challenge: String,
    /// Expected to be `S256`.
    pub code_challenge_method: String,
    /// Optional requested scopes.
    #[serde(default)]
    #[allow(dead_code)]
    pub scope: Option<String>,
}

/// OAuth callback request from the upstream auth server.
#[derive(Deserialize)]
pub struct CallbackRequest {
    /// Authorization code from the upstream auth server.
    pub code: String,
    /// Broker session ID threaded through the upstream `state`.
    pub state: Option<String>,
}

/// OAuth token request from the MCP client.
#[derive(Deserialize)]
pub struct TokenRequest {
    /// Supported values are `authorization_code` and `refresh_token`.
    pub grant_type: String,
    /// Authorization code issued by this broker.
    #[serde(default)]
    pub code: Option<String>,
    /// PKCE verifier.
    #[serde(default)]
    pub code_verifier: Option<String>,
    /// Refresh token returned by a prior token exchange.
    #[serde(default)]
    pub refresh_token: Option<RefreshToken>,
    /// Redirect URI from the original authorization request.
    #[serde(default)]
    pub redirect_uri: Option<String>,
    /// Optional client id.
    #[serde(default)]
    #[allow(dead_code)]
    pub client_id: Option<String>,
}

/// OAuth token response returned to the MCP client.
#[derive(Serialize)]
pub struct TokenResponse {
    /// Bearer access token.
    pub access_token: AccessToken,
    /// Refresh token for subsequent token refresh.
    pub refresh_token: RefreshToken,
    /// OAuth token type.
    pub token_type: &'static str,
}
