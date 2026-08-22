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
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Error returned when a session identifier is not UUIDv7.
#[derive(Debug, thiserror::Error)]
#[error("session ID must be UUIDv7")]
pub struct ParseSessionIdError;

/// Validated, normalized email address.
#[derive(Clone, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Email(String);

impl Email {
    /// Parses, trims, and lowercases an email address.
    pub fn parse(raw: &str) -> Result<Self, ParseEmailError> {
        let email = raw.trim().to_lowercase();
        if !email_validator::is_valid_email(&email) {
            return Err(ParseEmailError);
        }
        Ok(Self(email))
    }

    /// Returns the normalized email address.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Email {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Email").field(&self.0).finish()
    }
}

impl<'de> Deserialize<'de> for Email {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Error returned when an email address is invalid.
#[derive(Debug, thiserror::Error)]
#[error("invalid email address")]
pub struct ParseEmailError;

/// Validated six-digit passwordless code.
#[derive(Clone, Eq, PartialEq)]
pub struct OneTimeCode(String);

impl OneTimeCode {
    /// Parses a six-digit passwordless code.
    pub fn parse(raw: &str) -> Result<Self, ParseOneTimeCodeError> {
        let code = raw.trim();
        if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(ParseOneTimeCodeError);
        }
        Ok(Self(code.to_owned()))
    }

    /// Returns the passwordless code.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for OneTimeCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("OneTimeCode([REDACTED])")
    }
}

/// Error returned when a passwordless code is not six digits.
#[derive(Debug, thiserror::Error)]
#[error("passwordless code must contain six digits")]
pub struct ParseOneTimeCodeError;

/// Broker-owned return URL for the product passwordless flow.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResumeUri(String);

impl ResumeUri {
    /// Builds the login URL for a broker session.
    pub fn broker_login(public_url: &str, session_id: &SessionId) -> Self {
        Self(format!(
            "{}/login/{session_id}",
            public_url.trim_end_matches('/')
        ))
    }

    /// Parses a return URL and requires the broker's origin.
    pub fn parse_on_broker(raw: &str, public_url: &str) -> Result<Self, ParseResumeUriError> {
        let parsed = url::Url::parse(raw).map_err(|_| ParseResumeUriError)?;
        let broker = url::Url::parse(public_url).map_err(|_| ParseResumeUriError)?;
        if parsed.origin() != broker.origin() || !is_browser_safe_origin(&broker) {
            return Err(ParseResumeUriError);
        }
        Ok(Self(parsed.to_string()))
    }

    /// Returns the return URL.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_browser_safe_origin(url: &url::Url) -> bool {
    url.scheme() == "https"
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}

/// Error returned when a passwordless return URL is not broker-owned.
#[derive(Debug, thiserror::Error)]
#[error("resume URI must use the broker origin")]
pub struct ParseResumeUriError;

/// FusionAuth identity provider used for an upstream login.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IdentityProvider {
    /// The configured Google Gmail identity provider.
    GoogleGmail,
    /// A domain-specific identity provider returned by authentication service.
    DomainSso {
        /// FusionAuth identity provider identifier.
        idp_id: String,
    },
}

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

/// Current credential-acquisition phase.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoginPhase {
    /// The user is choosing a sign-in method.
    ChoosingMethod,
    /// FusionAuth is handling Google or domain SSO.
    AwaitingUpstream {
        /// Identity provider selected for the upstream login.
        identity_provider: IdentityProvider,
    },
    /// Authentication service sent a passwordless code to this email.
    AwaitingOtp {
        /// Email tied to the passwordless code.
        email: Email,
    },
}

/// In-flight MCP authorization session.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AuthorizationSession {
    /// Broker session identifier.
    pub id: SessionId,
    /// MCP client callback details.
    pub client: ClientCallback,
    /// Current login phase.
    pub phase: LoginPhase,
}

/// Result of starting an MCP authorization flow.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorizationStart {
    /// Continue on the broker-hosted login page.
    Login {
        /// Broker session identifier.
        session_id: SessionId,
    },
}

/// Read model rendered by the broker-hosted login page.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoginSurface {
    /// Let the user choose Google or email.
    ChooseMethod {
        /// Broker session identifier.
        session_id: SessionId,
    },
    /// Ask the user for an email address.
    EnterEmail {
        /// Broker session identifier.
        session_id: SessionId,
        /// User-safe error from the previous attempt.
        error: Option<LoginPageError>,
    },
    /// Ask the user for the passwordless code.
    EnterOtp {
        /// Broker session identifier.
        session_id: SessionId,
        /// Email tied to the passwordless code.
        email: Email,
        /// Code returned by authentication service in local environments.
        local_otp: Option<OneTimeCode>,
        /// User-safe error from the previous attempt.
        error: Option<LoginPageError>,
    },
    /// The session is missing or expired.
    Expired,
}

/// User-safe login page error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LoginPageError {
    /// The email address is invalid.
    InvalidEmail,
    /// The passwordless code is invalid.
    InvalidOtp,
    /// Authentication service rejected the attempt due to rate limits.
    RateLimited,
    /// The selected sign-in method is temporarily unavailable.
    Unavailable,
    /// The action is not valid in the current login phase.
    WrongPhase,
}

/// User action parsed from the broker login form.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoginAction {
    /// Continue with Google.
    ChooseGoogle,
    /// Start or resend passwordless login.
    SubmitEmail {
        /// Validated email address.
        email: Email,
        /// Broker-owned URL used by passwordless email links.
        resume_uri: ResumeUri,
    },
    /// Complete passwordless login.
    SubmitOtp(OneTimeCode),
    /// Return to sign-in method selection.
    Back,
}

/// Result of a login page action.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoginAdvance {
    /// Render another broker login page.
    Show(LoginSurface),
    /// Redirect to FusionAuth or the MCP client.
    Redirect(RedirectTo),
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

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

/// Input for an upstream FusionAuth authorization redirect.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpstreamAuthorize {
    /// Broker session identifier threaded through OAuth `state`.
    pub state: SessionId,
    /// FusionAuth identity provider to use.
    pub identity_provider: IdentityProvider,
    /// Optional email hint for domain SSO.
    pub login_hint: Option<Email>,
}

/// Command that starts product passwordless login.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StartPasswordless {
    /// Validated email address.
    pub email: Email,
    /// Broker-owned URL used by passwordless email links.
    pub resume_uri: ResumeUri,
}

/// Command that completes product passwordless login.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompletePasswordless {
    /// Email tied to the passwordless code.
    pub email: Email,
    /// User-provided passwordless code.
    pub otp: OneTimeCode,
}

/// Result of starting product passwordless login.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PasswordlessStartResult {
    /// Authentication service sent a passwordless code.
    Sent {
        /// Code returned only by local authentication service builds.
        local_otp: Option<OneTimeCode>,
    },
    /// The email domain requires SSO.
    SsoRequired {
        /// FusionAuth identity provider identifier.
        idp_id: String,
    },
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
