//! The daemon's one input: a TOML file describing the Macro deployment it
//! serves, the webhook server it listens on, and the harness it runs per
//! session. See `config.example.toml` at the crate root.
//!
//! Deliberately credential-free: identity comes from pairing (press `p` in
//! the control panel), which persists the harness credential in a state file
//! next to this config.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// Everything the daemon needs, parsed from one TOML file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// The Macro deployment this harness's sessions live in.
    #[serde(rename = "macro")]
    pub macro_api: MacroApi,
    /// How this daemon introduces itself when pairing.
    #[serde(default)]
    pub identity: Identity,
    /// The webhook server this daemon listens on.
    pub server: Server,
    /// The harness process spawned per session.
    pub harness: Harness,
    /// The workspace every session runs against.
    pub workspace: Workspace,
}

/// The Macro deployment this harness's sessions live in.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MacroApi {
    /// Base URL of the agent-harness service, e.g.
    /// `http://localhost:50009/agent-harness`. Sessions are created and
    /// prompted here, and its `ws(s)` twin hosts the runtime gateway.
    pub api_url: String,
    /// Base URL of the storage service, e.g. `http://localhost:50009/dss`.
    /// Hosts the harness pairing and webhook APIs.
    pub storage_url: String,
    /// Base URL of the Macro web app, used only to print the pairing link.
    #[serde(default = "default_web_url")]
    pub web_url: String,
}

impl MacroApi {
    /// The dial-in URL for a session on this deployment's runtime gateway:
    /// the API base with a websocket scheme.
    pub fn gateway_url(&self) -> String {
        let base = self.api_url.trim_end_matches('/');
        let base = base
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{base}/runtime/ws")
    }

    /// The settings-page URL where a pairing code is approved.
    pub fn pairing_approval_url(&self, code: &str) -> String {
        let base = self.web_url.trim_end_matches('/');
        format!("{base}/settings/harness?pair={code}")
    }
}

/// How this daemon introduces itself when pairing.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    /// Requested harness display name; the approving user may rename it.
    /// Defaults to this machine's hostname.
    #[serde(default)]
    pub name: Option<String>,
    /// Whether the harness should be private to the approving user or shared
    /// with their team. Advisory: the approval dialog arrives preselected to
    /// this, and the approving user has the final say.
    #[serde(default)]
    pub scope: IdentityScope,
}

/// The ownership scope this daemon's pairing asks for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityScope {
    /// Only the approving user can run agents on this harness.
    #[default]
    Private,
    /// Any of the approving user's teammates can bind agents to it.
    Team,
}

/// The webhook server this daemon listens on.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Server {
    /// Port `POST /macro-events` is served on.
    pub port: u16,
    /// The URL webhook deliveries reach this daemon at - what the feed is
    /// registered with. Locally that is the stack's relay
    /// (`http://sdk-webhook-relay:8787/macro-events`); in production, a
    /// public HTTPS endpoint.
    pub public_url: String,
    /// Explicit signing secret, overriding boot-time feed registration.
    /// Normally absent: the daemon registers its own feed and keeps the
    /// minted secret in a state file next to the config.
    #[serde(default)]
    pub signing_secret: Option<String>,
}

/// The harness process spawned per session. Generic on purpose: any binary
/// speaking ACP over stdio fits here - opencode, claude, hermes - so a new
/// harness is a config change, not code.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Harness {
    /// The binary to run.
    pub command: String,
    /// Arguments, e.g. `["acp"]`.
    #[serde(default)]
    pub args: Vec<String>,
}

/// The workspace every session runs against.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    /// Absolute directory harnesses run in; sent as each session's
    /// workspace at creation.
    pub path: PathBuf,
    /// Repository nominally checked out at `path`, recorded on each
    /// session it serves. Informational: having the repo cloned there is
    /// the operator's job.
    #[serde(default)]
    pub repo_url: Option<String>,
}

fn default_web_url() -> String {
    "https://macro.com/app".to_owned()
}

/// Why a config failed to load.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The file could not be read.
    #[error("failed to read config at {path}")]
    Io {
        /// The path that failed.
        path: PathBuf,
        /// What reading it returned.
        #[source]
        source: std::io::Error,
    },
    /// The file is not a valid daemon config.
    #[error("invalid config at {path}")]
    Parse {
        /// The path that failed.
        path: PathBuf,
        /// What parsing it returned.
        #[source]
        source: toml::de::Error,
    },
}

impl Config {
    /// Load and parse the config at `path`.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let raw = std::fs::read_to_string(path).map_err(|source| ConfigError::Io {
            path: path.to_owned(),
            source,
        })?;
        toml::from_str(&raw).map_err(|source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        })
    }
}
