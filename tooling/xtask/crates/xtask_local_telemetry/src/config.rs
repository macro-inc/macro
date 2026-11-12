//! The per-user opt-in file, and where events wait to be sent.
//!
//! Telemetry is on only while `~/.config/macro/local-telemetry.toml` exists. The
//! file is the single source of both the switch and the credential: it lives
//! outside every repository and is read only by this process, so the token never
//! reaches a commit, a generated env file, or a container's environment.

use std::fmt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[cfg(test)]
mod test;

const CONFIG_FILE: &str = "macro/local-telemetry.toml";
const BUFFER_DIR: &str = "macro/local-telemetry";
/// Hosts a token may be sent to over plain HTTP: a throwaway Loki on this machine.
const LOOPBACK_HOSTS: &[&str] = &["localhost", "127.0.0.1", "[::1]"];

/// Where the opt-in file is read and where events are buffered.
#[derive(Clone, Debug)]
pub struct Paths {
    /// The opt-in file. Telemetry is off while it doesn't exist.
    pub config: PathBuf,
    /// Pending event files, one per recording process.
    pub buffer_dir: PathBuf,
}

impl Paths {
    /// The XDG locations for the current user, or `None` without a home directory.
    pub fn for_user() -> Option<Self> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let config_home =
            xdg_dir("XDG_CONFIG_HOME").or_else(|| Some(home.clone()?.join(".config")));
        let state_home =
            xdg_dir("XDG_STATE_HOME").or_else(|| Some(home?.join(".local").join("state")));
        Some(Self {
            config: config_home?.join(CONFIG_FILE),
            buffer_dir: state_home?.join(BUFFER_DIR),
        })
    }
}

/// XDG says a relative value is invalid and must be ignored.
fn xdg_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
}

/// The OTLP/HTTP collector, a bearer token for it, and what to send.
#[derive(Debug)]
pub struct Config {
    endpoint: String,
    token: Option<Token>,
    traces: bool,
}

/// The opt-in file as written.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    endpoint: String,
    token: Option<String>,
    traces: Option<bool>,
}

/// A bearer token. Its `Debug` and `Display` never show the value.
pub struct Token(String);

impl Token {
    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

/// Why an opt-in file was ignored. No variant carries the file's contents.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The file exists but couldn't be read.
    #[error("cannot read {path}: {source}")]
    Read {
        /// The opt-in file.
        path: PathBuf,
        /// The read failure.
        source: std::io::Error,
    },
    /// The file isn't valid TOML of the expected shape.
    #[error("{path} is not valid: {message}")]
    Invalid {
        /// The opt-in file.
        path: PathBuf,
        /// The parser's message, without the source line that could hold the token.
        message: String,
    },
    /// `endpoint` isn't an `http(s)://` URL, or would send a token in the clear.
    #[error("{path}: `endpoint` must be an https:// URL (http:// only for localhost)")]
    Endpoint {
        /// The opt-in file.
        path: PathBuf,
    },
    /// Others on the machine could read the token.
    #[error("{path} holds a token but is readable by others; run `chmod 600` on it")]
    Permissions {
        /// The opt-in file.
        path: PathBuf,
    },
}

impl Config {
    /// Read the opt-in file: `Ok(None)` when it doesn't exist, so telemetry is off.
    pub fn load(path: &Path) -> Result<Option<Self>, ConfigError> {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(source) => {
                return Err(ConfigError::Read {
                    path: path.to_owned(),
                    source,
                });
            }
        };
        let file: ConfigFile = toml::from_str(&text).map_err(|error| ConfigError::Invalid {
            path: path.to_owned(),
            message: error.message().to_owned(),
        })?;

        let endpoint = file.endpoint.trim_end_matches('/').to_owned();
        if !endpoint_is_safe(&endpoint) {
            return Err(ConfigError::Endpoint {
                path: path.to_owned(),
            });
        }

        let token = file.token.filter(|token| !token.is_empty()).map(Token);
        if token.is_some() && readable_by_others(path) {
            return Err(ConfigError::Permissions {
                path: path.to_owned(),
            });
        }

        Ok(Some(Self {
            endpoint,
            token,
            traces: file.traces.unwrap_or(true),
        }))
    }

    /// The OTLP logs route, which Loki stores.
    pub(crate) fn logs_url(&self) -> String {
        format!("{}/v1/logs", self.endpoint)
    }

    /// The OTLP traces route, when traces are wanted.
    pub(crate) fn traces_url(&self) -> Option<String> {
        self.traces.then(|| format!("{}/v1/traces", self.endpoint))
    }

    pub(crate) fn token(&self) -> Option<&Token> {
        self.token.as_ref()
    }
}

fn endpoint_is_safe(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    match url.scheme() {
        "https" => url.host().is_some(),
        "http" => url
            .host_str()
            .is_some_and(|host| LOOPBACK_HOSTS.contains(&host)),
        _ => false,
    }
}

fn readable_by_others(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.permissions().mode() & 0o077 != 0)
        .unwrap_or(true)
}
