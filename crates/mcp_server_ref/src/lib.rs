#![deny(missing_docs)]

//! A reference to an MCP server a user registered in their settings.
//!
//! Macro has two connector stacks with two registries: the native stack keys a
//! server by the URL the user typed in, the Pipedream stack by the connected
//! app's slug. An agent that names the servers it may use has to be able to
//! name either, so the reference is a tagged pair rather than a bare string.
//! It is shared by the crate that persists agents, the crate that runs them,
//! and the proxy that serves their traffic, so it lives in this leaf crate the
//! way `bot_id` and `harness_id` do.
//!
//! Macro's own MCP server is never referenced: every agent has it, so there is
//! nothing to select.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Which registry a server reference points into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum McpServerKind {
    /// The native stack: a server the user added by URL.
    Native,
    /// The Pipedream stack: an app the user connected through Pipedream.
    Pipedream,
}

impl McpServerKind {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Pipedream => "pipedream",
        }
    }
}

impl std::str::FromStr for McpServerKind {
    type Err = McpServerRefParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "native" => Ok(Self::Native),
            "pipedream" => Ok(Self::Pipedream),
            other => Err(McpServerRefParseError::UnknownKind(other.to_owned())),
        }
    }
}

/// One user-registered MCP server, as an agent's configuration names it.
///
/// The reference carries no credentials and no owner: it says *which* server,
/// and whoever runs the agent resolves it against their own registrations at
/// session time.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum McpServerRef {
    /// A native-stack server, identified by its streamable HTTP URL.
    Native {
        /// The server URL exactly as the user registered it.
        url: String,
    },
    /// A Pipedream-connected app, identified by Pipedream's app slug.
    Pipedream {
        /// Pipedream app name slug, e.g. `linear`.
        app_slug: String,
    },
}

impl McpServerRef {
    /// A reference to a native-stack server.
    pub fn native(url: impl Into<String>) -> Self {
        Self::Native { url: url.into() }
    }

    /// A reference to a Pipedream-connected app.
    pub fn pipedream(app_slug: impl Into<String>) -> Self {
        Self::Pipedream {
            app_slug: app_slug.into(),
        }
    }

    /// Which registry this reference points into.
    pub const fn kind(&self) -> McpServerKind {
        match self {
            Self::Native { .. } => McpServerKind::Native,
            Self::Pipedream { .. } => McpServerKind::Pipedream,
        }
    }

    /// The identifier within its registry: the URL or the app slug.
    pub fn reference(&self) -> &str {
        match self {
            Self::Native { url } => url,
            Self::Pipedream { app_slug } => app_slug,
        }
    }

    /// Rebuild a reference from its two storage columns.
    pub fn from_columns(
        kind: &str,
        reference: impl Into<String>,
    ) -> Result<Self, McpServerRefParseError> {
        let reference = reference.into();
        if reference.is_empty() {
            return Err(McpServerRefParseError::EmptyReference);
        }
        Ok(match kind.parse::<McpServerKind>()? {
            McpServerKind::Native => Self::Native { url: reference },
            McpServerKind::Pipedream => Self::Pipedream {
                app_slug: reference,
            },
        })
    }
}

impl std::fmt::Display for McpServerRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.kind().as_str(), self.reference())
    }
}

/// Why two storage columns did not make a server reference.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum McpServerRefParseError {
    /// The kind column held a value this crate does not know.
    #[error("unknown mcp server kind: {0}")]
    UnknownKind(String),
    /// The reference column was empty.
    #[error("mcp server reference must not be empty")]
    EmptyReference,
}
