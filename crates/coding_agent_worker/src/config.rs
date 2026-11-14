//! The daemon's one input: `macrod.toml`, this machine's local config - the
//! harness it runs, its workspace, native Herdr defaults, and the pairing
//! credential. The TUI and `macrod service` share one file per runtime:
//! `~/.macrod/macrod.toml`, or a named profile beside it (see
//! [`crate::profiles`]). See `config.example.toml` at the crate root.
//!
//! Runtime settings - the name, ownership, and permission bypass - live on the
//! web at Settings → Runtimes, not here. Pairing (press `p` in the
//! control panel) adds the harness credential to this file. Treat it as
//! sensitive because that credential is a bearer token.

use harness_id::HarnessId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
    // Windows usually sets no `HOME`; this is its home directory.
    macro_env_var::maybe_env_var! {
        pub struct Userprofile;
    }
}

/// Everything the daemon needs, parsed from one TOML file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// The Macro deployment this harness's sessions live in: production
    /// unless the file overrides it for development.
    #[serde(rename = "macro", default)]
    pub macro_api: MacroApi,
    /// The approved harness credential, absent until pairing completes.
    #[serde(default)]
    pub credentials: Option<HarnessCredentials>,
    /// The harness process shared by every session.
    pub harness: Harness,
    /// The workspace every session runs against.
    pub workspace: Workspace,
    /// Native Herdr defaults shared by this macrod instance.
    #[serde(default)]
    pub herdr: HerdrSettings,
    /// Whether a released macrod keeps itself up to date.
    #[serde(default)]
    pub update: UpdateSettings,
    /// The agent monitor (`macrod monitor`).
    #[serde(default)]
    pub monitor: MonitorSettings,
}

/// The agent monitor: whether this macrod hosts the machine's collector, and
/// what the collector and viewer read. Unix only; other systems ignore it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MonitorSettings {
    /// Host the collector in this macrod (the panel or `macrod service`),
    /// unless another process already serves the machine.
    pub enabled: bool,
    /// Hours of history: transcripts are indexed back this far at startup,
    /// and an agent that ended (or last wrote) longer ago, with no live
    /// terminal or running process, is dropped.
    pub history_hours: u32,
    /// The viewer's frames per second while something animates; 0 stops
    /// animation.
    pub fps: u8,
    /// Extra directories of work-run records (`<id>.json` with `<id>.cost`);
    /// a leading `~` is the home directory.
    pub run_record_dirs: Vec<PathBuf>,
    /// hc terminal labels whose value is a work run's id, joining the run to
    /// its terminal.
    pub run_id_labels: Vec<String>,
    /// Seconds between pull request status polls of GitHub (through the `gh`
    /// CLI, one batched query per 100 lookups) while a viewer watches; at
    /// most every 5 minutes with none.
    /// 0 turns pull request status off.
    pub pr_poll_secs: u32,
}

impl Default for MonitorSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            history_hours: 24,
            fps: 12,
            run_record_dirs: Vec::new(),
            run_id_labels: Vec::new(),
            pr_poll_secs: 60,
        }
    }
}

impl MonitorSettings {
    /// The `[monitor]` table of the config at `path`, without loading the
    /// rest: `macrod monitor` runs on a machine that was never paired. A
    /// missing file or table means the defaults.
    pub fn read(path: &Path) -> Result<Self, ConfigError> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(source) => {
                return Err(ConfigError::Io {
                    path: path.to_owned(),
                    source,
                });
            }
        };
        let parse = |source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        };
        let mut table: toml::Table = toml::from_str(&raw).map_err(parse)?;
        match table.remove("monitor") {
            Some(monitor) => monitor.try_into().map_err(parse),
            None => Ok(Self::default()),
        }
    }
}

/// Self-update preferences. `MACROD_NO_UPDATE=1` turns updating off too.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UpdateSettings {
    /// Install newer releases automatically. On by default.
    pub auto: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self { auto: true }
    }
}

/// One native launch configuration, shared by all new sessions.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HerdrSettings {
    /// Native model ID; absent uses the CLI's configured default. Only the
    /// native CLI's launch fallback: Macro picks each agent's model.
    pub model: Option<String>,
    /// Extra native CLI arguments, already split into words.
    pub arguments: Vec<String>,
    /// Repository cache and worktree location; absent uses instance storage.
    pub storage_path: Option<PathBuf>,
    /// Switch Herdr to newly launched sessions.
    pub focus: bool,
}

impl Default for HerdrSettings {
    fn default() -> Self {
        Self {
            model: None,
            arguments: Vec::new(),
            storage_path: None,
            focus: true,
        }
    }
}

/// The credential pairing minted for this daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HarnessCredentials {
    /// The registered harness this daemon serves.
    pub harness_id: HarnessId,
    /// The bearer token (`mhns_...`).
    pub token: String,
    /// The Macro computer enrollment pairing this credential was claimed
    /// from; a newer enrollment's pairing must be claimed again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairing_id: Option<pairing_id::PairingId>,
}

impl HarnessCredentials {
    /// Whether this credential has the expected non-empty bearer-token shape.
    pub fn is_valid(&self) -> bool {
        self.token
            .strip_prefix("mhns_")
            .is_some_and(|secret| !secret.is_empty())
    }
}

/// The Macro deployment this harness's sessions live in. Every field defaults
/// to production; values in the file are development overrides.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MacroApi {
    /// Computer-reachable egress base; enrollment overrides local routing.
    #[serde(default)]
    pub egress_url: Option<String>,
    /// Base URL of the agent-harness service, e.g.
    /// `http://localhost:50009/agent-harness`. Sessions are created and
    /// prompted here, and its `ws(s)` twin hosts the runtime gateway.
    pub api_url: String,
    /// Base URL of the storage service, e.g. `http://localhost:50009/dss`.
    /// Hosts harness pairing and `GET /webhook/events/stream`.
    pub storage_url: String,
    /// Base URL of the Macro web app, used for the pairing and settings links.
    pub web_url: String,
}

impl Default for MacroApi {
    fn default() -> Self {
        Self {
            egress_url: None,
            api_url: "https://gateway.macro.com/agent-harness".to_owned(),
            storage_url: "https://gateway.macro.com/dss".to_owned(),
            web_url: "https://macro.com/app".to_owned(),
        }
    }
}

impl MacroApi {
    /// The dial-in URL for this deployment's runtime gateway:
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
        format!("{}?pair={code}", self.settings_url())
    }

    /// The settings page where runtimes are renamed, shared, and granted
    /// permission bypass.
    pub fn settings_url(&self) -> String {
        let base = self.web_url.trim_end_matches('/');
        format!("{base}/settings/runtimes")
    }
}

/// The harness process shared by every session. Generic on purpose: any binary
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
    /// Environment added to the harness process and to every model probe, on
    /// top of the daemon's own.
    ///
    /// ACP adapters distributed on npm bundle their own copy of the CLI they
    /// wrap and run it unless told otherwise. A bundled CLI older than the
    /// one the operator installed advertises a different model catalogue, so
    /// the presets point the adapter at the installed CLI through the
    /// variable it reads for that - `CODEX_PATH`, `CLAUDE_CODE_EXECUTABLE`.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// The workspace every session runs against.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    /// Absolute directory generic harnesses run in. Native Herdr searches
    /// this directory for existing clones and creates a worktree per session.
    pub path: PathBuf,
    /// Default repository when dispatch does not specify one. Generic
    /// harnesses expect it at `path`; native Herdr can find or clone it.
    #[serde(default)]
    pub repo_url: Option<String>,
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
    /// The file sets something that is configured on the web now.
    #[error(
        "{path} sets {key}, which macrod no longer reads: a machine's name, access, and \
         permission bypass are set in Macro at Settings → Machines. Delete {key} from \
         the file."
    )]
    WebSetting {
        /// The path that failed.
        path: PathBuf,
        /// The key to delete, e.g. `[identity]`.
        key: &'static str,
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
        let parse = |source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        };
        let table: toml::Table = toml::from_str(&raw).map_err(parse)?;
        if let Some(key) = web_setting_in(&table) {
            return Err(ConfigError::WebSetting {
                path: path.to_owned(),
                key,
            });
        }
        table.try_into().map_err(parse)
    }
}

/// A key older releases wrote for what is now set on the web, if the file has
/// one. Named in the error so the operator knows exactly what to delete.
fn web_setting_in(table: &toml::Table) -> Option<&'static str> {
    if table.contains_key("identity") {
        return Some("[identity]");
    }
    table
        .get("credentials")
        .and_then(toml::Value::as_table)
        .is_some_and(|credentials| credentials.contains_key("scope"))
        .then_some("`scope` in [credentials]")
}

/// macrod's directory, `~/.macrod` (`%USERPROFILE%\.macrod` on Windows):
/// the default config, named profiles, adapter installs, and Herdr storage.
pub fn macrod_directory() -> Option<PathBuf> {
    home_directory().map(|home| home.join(".macrod"))
}

/// The user's home directory, which holds `~/.macrod` and the directories
/// of the agents the monitor reads (`~/.claude`, `~/.codex`, `~/.herdr`).
pub fn home_directory() -> Option<PathBuf> {
    let home = environment::Home::new();
    let user_profile = environment::Userprofile::new();
    home_directory_from(
        home.as_ref().and_then(|home| home.value()),
        user_profile.as_ref().and_then(|profile| profile.value()),
    )
}

/// `HOME` wins; `USERPROFILE` is the fallback Windows needs.
fn home_directory_from(home: Option<&str>, user_profile: Option<&str>) -> Option<PathBuf> {
    [home, user_profile]
        .into_iter()
        .flatten()
        .find(|directory| !directory.is_empty())
        .map(PathBuf::from)
}

/// An exclusive hold on one config: one macrod serves one harness.
/// Released when dropped or when the process exits.
#[derive(Debug)]
pub struct ConfigLock {
    _file: std::fs::File,
}

/// Why a config could not be locked.
#[derive(Debug, thiserror::Error)]
pub enum LockError {
    /// Another process holds the lock.
    #[error("another macrod is already running with {}", path.display())]
    Held {
        /// The config being served.
        path: PathBuf,
    },
    /// The lock file could not be opened or locked.
    #[error("could not lock {}", path.display())]
    Io {
        /// The lock file.
        path: PathBuf,
        /// What opening or locking it returned.
        #[source]
        source: std::io::Error,
    },
}

/// `<config>.lock`, the advisory lock file beside `config`.
fn lock_path(config: &Path) -> PathBuf {
    let mut name = config.as_os_str().to_owned();
    name.push(".lock");
    PathBuf::from(name)
}

/// Take the advisory lock `<config>.lock` beside `config`, failing fast when
/// another macrod already holds it.
pub fn lock(config: &Path) -> Result<ConfigLock, LockError> {
    let lock_path = lock_path(config);
    let io_error = |source| LockError::Io {
        path: lock_path.clone(),
        source,
    };
    if let Some(parent) = lock_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(io_error)?;
    match file.try_lock() {
        Ok(()) => Ok(ConfigLock { _file: file }),
        Err(std::fs::TryLockError::WouldBlock) => Err(LockError::Held {
            path: config.to_owned(),
        }),
        Err(std::fs::TryLockError::Error(source)) => Err(io_error(source)),
    }
}

/// Whether a macrod is serving `config` right now. Probes the lock and lets
/// go at once; never creates the lock file.
pub fn is_served(config: &Path) -> std::io::Result<bool> {
    let file = match std::fs::OpenOptions::new()
        .write(true)
        .open(lock_path(config))
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    match file.try_lock() {
        Ok(()) => Ok(false),
        Err(std::fs::TryLockError::WouldBlock) => Ok(true),
        Err(std::fs::TryLockError::Error(source)) => Err(source),
    }
}

/// Remove the lock file beside `config`, once its config has moved away.
pub fn remove_lock_file(config: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(lock_path(config)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}
