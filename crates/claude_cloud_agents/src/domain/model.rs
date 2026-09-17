//! Validated provider identities and safe failures.
use serde::{Deserialize, Serialize};

/// The deliberately bounded failures exposed to Macro. Never includes HTTP bodies.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The cloud environment cannot safely allow the deployment's MCP gateway.
    #[error(
        "Claude's environment cannot reach Macro's MCP gateway. Check its network settings in Claude Code on the web, then start a new session."
    )]
    EnvironmentNetwork,
    /// MCP setup failed or the worker did not acknowledge it before prompting.
    #[error(
        "Claude could not connect the session's MCP servers; check the harness connection and retry"
    )]
    McpConfiguration,
    /// Invalid choice or a provider-rejected switch; does not expose provider bodies.
    #[error(
        "Claude could not select that model. Choose another model available on your subscription."
    )]
    ModelUnavailable,
    /// The demo requires one unambiguous active Claude Code cloud environment.
    #[error(
        "This demo needs exactly one active Claude Code cloud environment. Check Claude Code on the web first."
    )]
    CloudEnvironment,
    /// No configured credentials for this session owner.
    #[error("Connect Claude for this Macro user before starting a Claude Cloud session")]
    NotConnected,
    /// Expired, revoked, or insufficient OAuth grant.
    #[error("Claude authorization failed; reconnect Claude")]
    Authorization,
    /// Provider rejected a request; body is intentionally omitted.
    #[error("Claude cloud request failed (HTTP {0})")]
    Http(u16),
    /// Transport failed, with secrets and response bodies omitted.
    #[error("Claude cloud connection interrupted")]
    Network,
    /// A malformed or unsupported response.
    #[error("Unsupported Claude cloud response")]
    Protocol,
    /// Local credential storage cannot be used safely.
    #[error("Claude credential storage is unavailable or invalid; retry or reconnect Claude")]
    Credentials,
    /// An uncertain create must not be automatically repeated.
    #[error(
        "Claude session creation outcome is uncertain; inspect the Claude account before retrying"
    )]
    UncertainCreate,
    /// A stream replay cannot be safely reconciled.
    #[error("Claude history recovery is required; reconnect the session")]
    Recovery,
    /// The local or cloud conversation still has an unfinished turn.
    #[error(
        "Claude still has a turn in progress; stop it or wait and reload before prompting again"
    )]
    Busy,
}

/// One operation's safe result.
pub type Result<T> = std::result::Result<T, Error>;

/// A validated Claude cloud session identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionId(String);
impl SessionId {
    /// Validate before interpolation in URLs.
    pub fn parse(value: &str) -> Result<Self> {
        if !value.starts_with("cse_")
            || value.len() <= 4
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err(Error::Protocol);
        }
        Ok(Self(value.to_owned()))
    }
    /// Provider's wire identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Claude's web UI for this cloud conversation.
    pub fn web_url(&self) -> String {
        format!("https://claude.ai/code/{}", self.0)
    }
}

/// An OAuth credential, redacted in diagnostics and zeroized on drop.
#[derive(Clone)]
pub struct Secret(zeroize::Zeroizing<String>);
impl Secret {
    /// Reject empty credentials and header-control characters.
    pub fn parse(value: String) -> Result<Self> {
        if value.is_empty()
            || value.len() > 16_384
            || value
                .bytes()
                .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        {
            return Err(Error::Credentials);
        }
        Ok(Self(zeroize::Zeroizing::new(value)))
    }
    /// Plaintext, only for the provider or private persistence.
    pub fn expose(&self) -> &str {
        &self.0
    }
}
impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}
impl Serialize for Secret {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.expose())
    }
}
impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// Owner-bound demo credentials; this structure must never be returned by an API.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Credentials {
    /// Short-lived OAuth bearer.
    pub access_token: Secret,
    /// Refresh grant, when consent provided one.
    pub refresh_token: Option<Secret>,
    /// Unix timestamp in seconds.
    pub expires_at: u64,
    /// Claude organization selected at consent.
    pub organization_id: String,
    /// Environment explicitly selected for this account.
    pub environment_id: String,
}

/// A decoded provider SSE event, independent of the HTTP implementation.
#[derive(Debug, Clone)]
pub struct Event {
    /// SSE event name.
    pub kind: String,
    /// Decoded JSON payload.
    pub data: serde_json::Value,
    /// Durable sequence number, absent on ephemeral deltas.
    pub sequence: Option<u64>,
}
