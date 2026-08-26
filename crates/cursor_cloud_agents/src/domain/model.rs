//! Identifiers and small value types shared across the crate.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};

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

/// A run's state as `GET /v1/agents/{id}/runs/{run}` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutcome {
    /// Where the run is in its lifecycle.
    pub status: RunStatus,
    /// The final assistant reply, present once the run is terminal.
    pub text: Option<String>,
}

impl RunOutcome {
    /// Whether the run has ended, in any way. `Unknown` counts as terminal:
    /// a status this crate cannot read is not one worth polling forever on.
    #[must_use]
    pub fn is_terminal(&self) -> bool {
        !matches!(self.status, RunStatus::Creating | RunStatus::Running)
    }
}

/// One run in an agent's history, as `GET /v1/agents/{id}/runs` lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunListing {
    /// The run's id.
    pub id: CursorRunId,
    /// Where the run is in its lifecycle.
    pub status: RunStatus,
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

/// A model choice: an id, plus the parameters that make it a *variant*.
///
/// Cursor validates the pair, not the id alone — `grok-4.5` with no params is
/// rejected with `does not match a known variant`, while the same id with
/// `effort=high, fast=true` is accepted. So a bare id is not a usable
/// selection and this type never models one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ModelChoice {
    /// The model id, e.g. `claude-sonnet-5`.
    pub id: String,
    /// The variant's parameters, in the order Cursor listed them.
    pub params: Vec<ModelParam>,
}

/// One tunable of a model variant, e.g. `effort=high`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelParam {
    /// The parameter's id, e.g. `effort`.
    pub id: String,
    /// The chosen value, e.g. `high`. A string even for booleans: Cursor's own
    /// enumeration gives `"true"`/`"false"` as values, not JSON booleans.
    pub value: String,
}

/// A model Cursor offers, as `GET /v1/models` describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorModel {
    /// The id to send, e.g. `gpt-5.5`.
    pub id: String,
    /// The name a person should see, e.g. `GPT-5.5`.
    pub display_name: String,
    /// The concrete id+params combinations Cursor will accept, one of which it
    /// marks as the default.
    pub variants: Vec<ModelVariant>,
}

impl CursorModel {
    /// The variant Cursor marks default, or its first — the params to send
    /// when a caller names a model and nothing more.
    ///
    /// Cursor rejects a selection whose params are not a known variant, so
    /// "the model with no params" is not an option; something has to be
    /// chosen, and Cursor's own default is the least surprising choice.
    #[must_use]
    pub fn default_variant(&self) -> Option<&ModelVariant> {
        self.variants
            .iter()
            .find(|variant| variant.is_default)
            .or_else(|| self.variants.first())
    }

    /// This model as a selection, using [`Self::default_variant`].
    #[must_use]
    pub fn default_choice(&self) -> ModelChoice {
        ModelChoice {
            id: self.id.clone(),
            params: self
                .default_variant()
                .map(|variant| variant.params.clone())
                .unwrap_or_default(),
        }
    }
}

/// One accepted id+params combination for a model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelVariant {
    /// The parameters this variant fixes.
    pub params: Vec<ModelParam>,
    /// Whether Cursor marks this the model's default variant.
    pub is_default: bool,
}
