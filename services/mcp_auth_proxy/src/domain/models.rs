use serde::{Deserialize, Serialize};
use std::{fmt, time::SystemTime};

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

/// A token grant obtained from the upstream OAuth provider.
#[derive(Debug)]
pub struct UpstreamTokens {
    /// The upstream access token.
    pub access_token: AccessToken,
    /// The upstream refresh token.
    pub refresh_token: RefreshToken,
    /// Seconds until `access_token` expires, as reported by the provider.
    pub expires_in: u64,
}

/// An MCP client created through dynamic client registration.
#[derive(Clone, Debug)]
pub struct RegisteredClient {
    /// Broker-assigned client identifier.
    pub client_id: String,
    /// Human-readable name submitted at registration.
    pub client_name: String,
    /// The redirect URIs submitted at registration. Nothing outside this set
    /// may receive an authorization code for this client.
    pub redirect_uris: Vec<String>,
}

impl RegisteredClient {
    /// Returns whether `uri` is one of this client's registered redirect URIs.
    ///
    /// Compared as an exact string, as RFC 6749 section 3.1.2.3 requires for
    /// redirect URIs that are not loopback addresses. Loopback ports vary per
    /// launch, but MCP clients re-register per port, so exact comparison holds
    /// for them too.
    pub fn permits_redirect_uri(&self, uri: &str) -> bool {
        self.redirect_uris
            .iter()
            .any(|registered| registered == uri)
    }
}

/// A dynamic client registration request from an MCP client.
#[derive(Debug, Deserialize)]
pub struct ClientRegistrationRequest {
    /// Human-readable client name.
    #[serde(default)]
    pub client_name: Option<String>,
    /// The redirect URIs the client will use.
    #[serde(default)]
    pub redirect_uris: Vec<String>,
}

/// The registration response returned to an MCP client.
#[derive(Debug, Serialize)]
pub struct ClientRegistrationResponse {
    /// Broker-assigned client identifier.
    pub client_id: String,
    /// Human-readable client name.
    pub client_name: String,
    /// The registered redirect URIs.
    pub redirect_uris: Vec<String>,
    /// Grant types this client may use.
    pub grant_types: [&'static str; 2],
    /// Response types this client may use.
    pub response_types: [&'static str; 1],
    /// Public clients hold no credential.
    pub token_endpoint_auth_method: &'static str,
}

/// A pending OAuth authorization flow initiated by the client.
#[derive(Clone)]
pub struct PendingAuthorization {
    /// The registered client that started the flow.
    pub client_id: String,
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
    /// The registered client this code was issued to. Only that client may
    /// redeem it.
    pub client_id: String,
    /// The access token obtained from the upstream provider.
    pub access_token: AccessToken,
    /// The refresh token obtained from the upstream provider.
    pub refresh_token: RefreshToken,
    /// The original PKCE code challenge, for verification at token exchange.
    pub code_challenge: String,
    /// The redirect URI from the authorization request, used for exact-match
    /// validation during token exchange.
    pub redirect_uri: String,
    /// When `access_token` expires. `None` for codes issued before the broker
    /// started tracking upstream token lifetimes.
    pub access_token_expires_at: Option<SystemTime>,
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
    #[allow(dead_code)]
    pub scope: Option<String>,
}

/// OAuth callback request from the upstream auth server.
#[derive(Deserialize)]
pub struct CallbackRequest {
    /// Authorization code from the upstream auth server. Absent when the
    /// upstream returned an error response instead of granting a code.
    #[serde(default)]
    pub code: Option<String>,
    /// Broker session ID threaded through the upstream `state`.
    pub state: Option<String>,
    /// OAuth error code when the upstream signals a failure.
    #[serde(default)]
    pub error: Option<String>,
    /// Human-readable error description from the upstream.
    #[serde(default)]
    pub error_description: Option<String>,
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
    /// The client redeeming the code or refresh token. Required: public clients
    /// hold no credential, so this is the only client identity the broker gets,
    /// and it must match the client the grant was issued to.
    #[serde(default)]
    pub client_id: Option<String>,
}

/// OAuth token response returned to the MCP client.
///
/// The token fields redact themselves when formatted, so `Debug` here does not
/// expose a credential.
#[derive(Debug, Serialize)]
pub struct TokenResponse {
    /// Bearer access token.
    pub access_token: AccessToken,
    /// Refresh token for subsequent token refresh.
    pub refresh_token: RefreshToken,
    /// OAuth token type.
    pub token_type: &'static str,
    /// Seconds until `access_token` expires, so clients can refresh before it
    /// does. Omitted when the upstream lifetime is unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}
