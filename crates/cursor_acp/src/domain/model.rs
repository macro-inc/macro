//! Identifiers and small value types shared across the crate.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};

/// The identity of one ACP session as this agent knows it.
///
/// Minted by the agent on `session/new` and echoed by the client on every
/// prompt. It is deliberately not the Cursor agent id: the ACP session exists
/// before the first prompt, while Cursor only mints an agent once there is a
/// prompt to run.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AcpSessionId(String);

impl AcpSessionId {
    /// Wrap an existing session id string.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// The id as the string the wire uses.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for AcpSessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The identity of a Cursor cloud agent (`bc-…`), which holds the
/// conversation across runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CursorAgentId(String);

impl CursorAgentId {
    /// Wrap an agent id as returned by the Cursor API.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// The id as the API path segment.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for CursorAgentId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The identity of one run (`run-…`) — one turn of a Cursor agent.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CursorRunId(String);

impl CursorRunId {
    /// Wrap a run id as returned by the Cursor API.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// The id as the API path segment.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for CursorRunId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// An HTTPS repository url in the form the Cursor API accepts,
/// e.g. `https://github.com/macro-inc/macro`.
///
/// Constructed only through [`RepoUrl::parse`], which normalizes the ssh and
/// scp-like forms a checkout's `origin` remote commonly uses. An agent
/// created without one still runs, but the Cursor dashboard files sessions
/// under a repository, so it never appears in the sessions list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RepoUrl(String);

impl RepoUrl {
    /// Normalize a git remote into the HTTPS url the Cursor API wants.
    ///
    /// `git@github.com:org/repo.git`, `ssh://git@github.com/org/repo.git` and
    /// `https://github.com/org/repo.git` all normalize to
    /// `https://github.com/org/repo`. Anything that does not end up HTTPS is
    /// rejected rather than guessed at.
    #[must_use]
    pub fn parse(remote: &str) -> Option<Self> {
        let remote = remote.trim();
        let normalized = if let Some(rest) = remote.strip_prefix("ssh://git@") {
            format!("https://{rest}")
        } else if let Some((host, path)) = remote
            .strip_prefix("git@")
            .and_then(|rest| rest.split_once(':'))
        {
            format!("https://{host}/{path}")
        } else {
            remote.to_owned()
        };
        let normalized = normalized.strip_suffix(".git").unwrap_or(&normalized);
        normalized
            .starts_with("https://")
            .then(|| Self(normalized.to_owned()))
    }

    /// The url as the API wants it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for RepoUrl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The lifecycle state of a run as the Cursor API reports it.
///
/// Non-exhaustive on the wire: statuses this crate has not seen round-trip
/// through [`RunStatus::Unknown`] rather than failing the stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunStatus {
    /// The run's environment is being prepared.
    Creating,
    /// The run is executing.
    Running,
    /// The run completed successfully.
    Finished,
    /// The run was cancelled.
    Cancelled,
    /// The run failed.
    Error,
    /// A status this crate does not know yet.
    #[serde(untagged)]
    Unknown(String),
}

/// An MCP server a session should make available to its Cursor agent.
///
/// Only the transports a *cloud* agent can honour. ACP's third transport,
/// stdio, names an executable by absolute path on the **client's** machine
/// (`command`, `args`, `env`); a Cursor agent runs in Cursor's sandbox, where
/// that path does not exist and where those env values — routinely API tokens
/// — would be shipped to be spawned. Forwarding it would produce a server
/// that looks configured and silently isn't, so the adapter declines it out
/// loud instead of modelling it here. See [`crate::inbound::acp`].
///
/// Cursor sets MCP configuration when an agent is created, so these belong to
/// the session from `session/new` onward and cannot change mid-conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    /// The client's name for the server, passed through unchanged.
    pub name: String,
    /// Which remote transport to speak.
    pub transport: McpTransport,
    /// The server's url.
    pub url: String,
    /// Headers to send with each request — typically the server's auth.
    pub headers: Vec<McpHeader>,
}

/// The remote MCP transports this agent can forward.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpTransport {
    /// Streamable HTTP.
    Http,
    /// Server-sent events.
    Sse,
}

impl McpTransport {
    /// The transport as the Cursor API's `type` discriminator.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Http => "http",
            Self::Sse => "sse",
        }
    }
}

/// One HTTP header for an MCP server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpHeader {
    /// Header name.
    pub name: String,
    /// Header value.
    pub value: String,
}
