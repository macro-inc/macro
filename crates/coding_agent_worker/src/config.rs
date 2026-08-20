//! The daemon's one input: a TOML file describing the bot it serves, the
//! webhook server it listens on, and the harness it runs per session. See
//! `config.example.toml` at the crate root.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// Everything the daemon needs, parsed from one TOML file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// The Macro deployment this bot's sessions live in.
    #[serde(rename = "macro")]
    pub macro_api: MacroApi,
    /// The webhook server this daemon listens on.
    pub server: Server,
    /// The harness process spawned per session.
    pub harness: Harness,
    /// The workspace every session runs against.
    pub workspace: Workspace,
}

/// The Macro deployment this bot's sessions live in, and how to act as the
/// bot there.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MacroApi {
    /// Base URL of the agent-harness service, e.g.
    /// `http://localhost:50009/agent-harness`. Sessions are created and
    /// prompted here, and its `ws(s)` twin hosts the runtime gateway.
    pub api_url: String,
    /// Base URL of the storage service, e.g. `http://localhost:50009/storage`.
    /// Hosts the bots and webhook APIs the daemon registers itself with.
    pub storage_url: String,
    /// The user who owns the bot; webhook registration acts for them.
    pub owner_user_id: String,
    /// The bot's API token (`mbot_...`).
    pub bot_token: String,
    /// Bot scope requests authorize under; `user` unless the bot is
    /// team-owned and should act in its team scope.
    #[serde(default = "default_bot_scope")]
    pub bot_scope: String,
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

fn default_bot_scope() -> String {
    "user".to_owned()
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
