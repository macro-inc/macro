//! The per-user settings file, the opt-out switches, and where events wait to be
//! sent.
//!
//! Telemetry is on by default. `~/.config/macro/local-telemetry.toml` holds the
//! endpoint and the token; when it doesn't exist, the sender writes it from
//! Doppler (see [`crate::provision`]). The file lives outside every repository and
//! is read only by this process, so the token never reaches a commit, a generated
//! env file, or a container's environment. `enabled = false` in it, or
//! `MACRO_LOCAL_TELEMETRY=off`, turns telemetry off; so does `CI`.

use std::ffi::OsString;
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
/// The shared OTLP ingest route, the one CI's `export-ci-telemetry` sends to.
pub const DEFAULT_ENDPOINT: &str = "https://otlp.macro-internal.com";
/// The environment variable that turns telemetry off (or on, under CI).
pub const SWITCH_VAR: &str = "MACRO_LOCAL_TELEMETRY";

/// Where settings are read, where events are buffered, and how a missing
/// settings file is provisioned.
#[derive(Clone, Debug)]
pub struct Paths {
    /// The settings file: endpoint, token, or `enabled = false`.
    pub config: PathBuf,
    /// Pending event files, one per recording process.
    pub buffer_dir: PathBuf,
    /// What `MACRO_LOCAL_TELEMETRY` and `CI` say.
    pub switch: Switch,
    /// How to write the settings file when it doesn't exist; `None` never writes it.
    pub provision: Option<Provision>,
}

impl Paths {
    /// The XDG locations for the current user, the environment's switch and the
    /// Doppler provisioning, or `None` without a home directory.
    pub fn for_user() -> Option<Self> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let config_home =
            xdg_dir("XDG_CONFIG_HOME").or_else(|| Some(home.clone()?.join(".config")));
        let state_home =
            xdg_dir("XDG_STATE_HOME").or_else(|| Some(home?.join(".local").join("state")));
        Some(Self {
            config: config_home?.join(CONFIG_FILE),
            buffer_dir: state_home?.join(BUFFER_DIR),
            switch: Switch::from_env(),
            provision: Some(Provision::doppler()),
        })
    }

    /// Explicit locations, no environment switch and no provisioning: for tests
    /// and callers that manage the settings file themselves.
    pub fn at(config: PathBuf, buffer_dir: PathBuf) -> Self {
        Self {
            config,
            buffer_dir,
            switch: Switch::Default,
            provision: None,
        }
    }
}

/// What the environment says about telemetry, read once per process.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Switch {
    /// Nothing set: on, as the settings file allows.
    #[default]
    Default,
    /// `MACRO_LOCAL_TELEMETRY=on`: on even under `CI`.
    On,
    /// `MACRO_LOCAL_TELEMETRY=off`, or `CI` is set: nothing is written or sent.
    Off,
}

impl Switch {
    /// Read `MACRO_LOCAL_TELEMETRY`, then `CI`.
    pub fn from_env() -> Self {
        let value = |name: &str| {
            std::env::var_os(name)
                .map(|value| value.to_string_lossy().trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
        };
        let ci = value("CI").is_some_and(|ci| ci != "0" && ci != "false");
        Self::parse(value(SWITCH_VAR).as_deref(), ci)
    }

    pub(crate) fn parse(switch: Option<&str>, ci: bool) -> Self {
        match switch {
            Some("0" | "off" | "false" | "no") => Self::Off,
            Some("1" | "on" | "true" | "yes") => Self::On,
            _ if ci => Self::Off,
            _ => Self::Default,
        }
    }
}

/// A command that prints the ingest token, and the endpoint to pair it with.
#[derive(Clone, Debug)]
pub struct Provision {
    /// Program and arguments; its trimmed stdout is the token.
    pub command: Vec<OsString>,
    /// Written as the file's `endpoint`.
    pub endpoint: String,
}

impl Provision {
    /// The developer's own `doppler login`, reading only the telemetry token from
    /// the `observability` project's `lcl` config. `run_local` downloads the
    /// `local` project, so this value never joins a generated env file. One short
    /// attempt: offline, it fails in seconds on a background thread.
    pub fn doppler() -> Self {
        let args = [
            "doppler",
            "secrets",
            "get",
            "LOCAL_TELEMETRY_TOKEN",
            "--plain",
            "--project",
            "observability",
            "--config",
            "lcl",
            "--no-check-version",
            "--attempts",
            "1",
            "--timeout",
            "5s",
        ];
        Self {
            command: args.iter().map(OsString::from).collect(),
            endpoint: DEFAULT_ENDPOINT.to_owned(),
        }
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
    provisioned: bool,
}

/// What the settings file says.
#[derive(Debug)]
pub(crate) enum Setting {
    /// `enabled = false`.
    Off,
    /// No file yet: provision one.
    Missing,
    /// Ready to send.
    On(Config),
}

/// The settings file as written.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    enabled: Option<bool>,
    endpoint: Option<String>,
    token: Option<String>,
    traces: Option<bool>,
    /// Written by provisioning, which may then replace a token that stops working.
    provisioned: Option<bool>,
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

/// Why a settings file was ignored. No variant carries the file's contents.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The file exists but couldn't be read.
    #[error("cannot read {path}: {source}")]
    Read {
        /// The settings file.
        path: PathBuf,
        /// The read failure.
        source: std::io::Error,
    },
    /// The file isn't valid TOML of the expected shape.
    #[error("{path} is not valid: {message}")]
    Invalid {
        /// The settings file.
        path: PathBuf,
        /// The parser's message, without the source line that could hold the token.
        message: String,
    },
    /// `endpoint` isn't an `http(s)://` URL, or would send a token in the clear.
    #[error(
        "{path}: `endpoint` must be an https:// URL (http:// only for localhost); `enabled = false` turns telemetry off"
    )]
    Endpoint {
        /// The settings file.
        path: PathBuf,
    },
    /// Others on the machine could read the token.
    #[error("{path} holds a token but is readable by others; run `chmod 600` on it")]
    Permissions {
        /// The settings file.
        path: PathBuf,
    },
}

impl Config {
    /// Read the settings file: [`Setting::Missing`] when it doesn't exist.
    pub(crate) fn load(path: &Path) -> Result<Setting, ConfigError> {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Setting::Missing);
            }
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

        if file.enabled == Some(false) {
            return Ok(Setting::Off);
        }

        let endpoint = file
            .endpoint
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_owned();
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

        Ok(Setting::On(Self {
            endpoint,
            token,
            traces: file.traces.unwrap_or(true),
            provisioned: file.provisioned.unwrap_or(false),
        }))
    }

    /// Whether provisioning wrote this file, so it may replace a rejected token.
    pub(crate) fn provisioned(&self) -> bool {
        self.provisioned
    }

    /// Whether `token` is this config's token.
    pub(crate) fn has_token(&self, token: &str) -> bool {
        self.token.as_ref().is_some_and(|own| own.expose() == token)
    }

    /// Whether `other` sends to the same place with the same token and options.
    pub(crate) fn same_as(&self, other: &Self) -> bool {
        self.endpoint == other.endpoint
            && self.traces == other.traces
            && self.token.as_ref().map(Token::expose) == other.token.as_ref().map(Token::expose)
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
