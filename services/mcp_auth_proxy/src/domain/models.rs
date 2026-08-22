use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

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

/// Broker authorization session identifier.
#[derive(Clone, Eq, Hash, PartialEq)]
pub struct SessionId(String);

impl SessionId {
    /// Creates a UUIDv7 session identifier.
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }

    /// Parses a UUIDv7 session identifier.
    pub fn parse(raw: &str) -> Result<Self, ParseSessionIdError> {
        let id = Uuid::parse_str(raw).map_err(|_| ParseSessionIdError)?;
        if id.get_version() != Some(uuid::Version::SortRand) {
            return Err(ParseSessionIdError);
        }
        Ok(Self(id.to_string()))
    }

    pub(crate) fn parse_compatible(raw: &str) -> Result<Self, ParseSessionIdError> {
        Uuid::parse_str(raw)
            .map(|id| Self(id.to_string()))
            .map_err(|_| ParseSessionIdError)
    }

    /// Returns the session identifier as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("SessionId").field(&self.as_str()).finish()
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for SessionId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SessionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Self::parse_compatible(&raw).map_err(serde::de::Error::custom)
    }
}

/// Error returned when a session identifier is not a UUID.
#[derive(Debug, thiserror::Error)]
#[error("session ID must be a UUID")]
pub struct ParseSessionIdError;

/// Client callback details that remain fixed during login.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientCallback {
    /// PKCE S256 code challenge from the client.
    pub code_challenge: String,
    /// The client's original `state` parameter.
    pub client_state: String,
    /// Where the broker redirects the client after authentication.
    pub client_redirect_uri: String,
}

/// In-flight MCP authorization session.
///
/// Login method choice and OTP live on the product frontend. This session only
/// holds the MCP client's PKCE and loopback callback.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AuthorizationSession {
    /// Broker session identifier.
    pub id: SessionId,
    /// MCP client callback details.
    pub client: ClientCallback,
}

/// Result of starting an MCP authorization flow.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorizationStart {
    /// Continue on the product login page.
    ProductLogin {
        /// Absolute product `/login` URL that includes `mcp_session`.
        redirect: RedirectTo,
    },
}

/// Validated redirect produced by the domain service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedirectTo(String);

impl RedirectTo {
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }

    /// Returns the redirect URL.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An authorization code issued by this broker and backed by product tokens.
#[derive(Clone)]
pub struct IssuedAuthorizationCode {
    /// The access token obtained from the product session.
    pub access_token: AccessToken,
    /// The refresh token obtained from the product session.
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
    pub scope: Option<String>,
}

/// Product tokens presented after the frontend finishes login.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProductTokens {
    /// Validated Macro access token.
    pub access_token: AccessToken,
    /// Matching FusionAuth refresh token.
    pub refresh_token: RefreshToken,
}

/// Response returned after the frontend completes an MCP login session.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CompleteLoginResponse {
    /// Loopback redirect for the MCP client.
    pub redirect: String,
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
    pub client_id: Option<String>,
}

/// OAuth token response returned to the MCP client.
#[derive(Debug, Serialize)]
pub struct TokenResponse {
    /// Bearer access token.
    pub access_token: AccessToken,
    /// Refresh token for subsequent token refresh.
    pub refresh_token: RefreshToken,
    /// OAuth token type.
    pub token_type: &'static str,
}

/// Returns whether a URL is safe to send a browser to.
pub fn is_browser_safe_origin(url: &url::Url) -> bool {
    url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}
