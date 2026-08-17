//! The worker's one input: a TOML file describing the session to serve and
//! the harness to run for it. See `config.example.toml` at the crate root.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// Everything the worker needs, parsed from one TOML file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// The session this worker serves and how to reach its gateway.
    pub session: Session,
    /// The harness process to spawn and bridge.
    pub harness: Harness,
    /// The workspace the harness runs against.
    #[allow(dead_code)] // consumed by the workspace-setup TODO
    pub workspace: Workspace,
}

/// The session this worker serves and how to reach its gateway.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    /// Agent session id, minted by the service that created the session.
    pub id: String,
    /// Websocket endpoint of the harness service's runtime gateway.
    pub gateway_url: String,
    /// Bearer token for the dial-in, minted alongside the session.
    pub token: String,
}

/// The harness process to spawn and bridge. Generic on purpose: any binary
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
    /// Working directory the harness runs in.
    pub cwd: PathBuf,
}

/// The workspace the harness runs against.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    /// Repository to make available at the harness's cwd.
    #[allow(dead_code)] // consumed by the workspace-setup TODO
    pub repo_url: String,
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
    /// The file is not a valid worker config.
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
