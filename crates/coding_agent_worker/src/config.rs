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
//!
//! Settings older releases wrote and macrod no longer reads are ignored when
//! loading and taken out of the file, with a backup, when a macrod starts on
//! it ([`migrate`]).

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
    /// Load and parse the config at `path`. Settings older releases wrote
    /// that macrod no longer reads ([`RETIRED_SETTINGS`]) are ignored here;
    /// [`migrate`] takes them out of the file.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let raw = std::fs::read_to_string(path).map_err(|source| ConfigError::Io {
            path: path.to_owned(),
            source,
        })?;
        let parse = |source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        };
        let mut table: toml::Table = toml::from_str(&raw).map_err(parse)?;
        for setting in &RETIRED_SETTINGS {
            match setting.key {
                None => {
                    table.remove(setting.table);
                }
                Some(key) => {
                    if let Some(section) = table
                        .get_mut(setting.table)
                        .and_then(toml::Value::as_table_mut)
                    {
                        section.remove(key);
                    }
                }
            }
        }
        table.try_into().map_err(parse)
    }
}

/// A setting a released macrod wrote that this one no longer reads.
struct RetiredSetting {
    /// The table it is in, or is.
    table: &'static str,
    /// The key inside `table`; `None` retires the whole table.
    key: Option<&'static str>,
    /// How the migration log names it.
    name: &'static str,
}

/// Every retired setting. A runtime's name, access, and permission bypass
/// (`[identity]`, the cached `scope` in `[credentials]`) are set on the web
/// at Settings → Runtimes; they were only sent when pairing, so dropping them
/// changes nothing for a paired runtime. `[server]` configured the webhook
/// listener the event stream replaced.
const RETIRED_SETTINGS: [RetiredSetting; 3] = [
    RetiredSetting {
        table: "identity",
        key: None,
        name: "[identity]",
    },
    RetiredSetting {
        table: "credentials",
        key: Some("scope"),
        name: "`scope` in [credentials]",
    },
    RetiredSetting {
        table: "server",
        key: None,
        name: "[server]",
    },
];

/// What [`migrate`] took out of a config, and where the original is kept.
#[derive(Debug, PartialEq, Eq)]
pub struct Migration {
    /// The settings removed, e.g. `[identity]`.
    pub removed: Vec<&'static str>,
    /// The file as it was before.
    pub backup: PathBuf,
}

/// Why a config could not be migrated.
#[derive(Debug, thiserror::Error)]
pub enum MigrateError {
    /// Reading the config, or writing it or its backup, failed.
    #[error("could not migrate {}", path.display())]
    Io {
        /// The file that failed.
        path: PathBuf,
        /// What the filesystem returned.
        #[source]
        source: std::io::Error,
    },
}

/// Take the [`RETIRED_SETTINGS`] out of the config at `path`, leaving the rest
/// of the file and its comments as they are. The original is copied to
/// `<path>.bak` first (`.bak.2`, `.bak.3`... when that exists; a backup is
/// never overwritten). `None` when there is no file, nothing to remove, or the
/// file is not valid TOML (loading it reports that).
pub fn migrate(path: &Path) -> Result<Option<Migration>, MigrateError> {
    let failed = |source| MigrateError::Io {
        path: path.to_owned(),
        source,
    };
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(failed(error)),
    };
    let Ok(mut document) = raw.parse::<toml_edit::DocumentMut>() else {
        return Ok(None);
    };
    let mut removed = Vec::new();
    for setting in &RETIRED_SETTINGS {
        let removed_here = match setting.key {
            None => document.remove(setting.table).is_some(),
            Some(key) => document
                .get_mut(setting.table)
                .and_then(toml_edit::Item::as_table_like_mut)
                .and_then(|section| section.remove(key))
                .is_some(),
        };
        if removed_here {
            removed.push(setting.name);
        }
    }
    if removed.is_empty() {
        return Ok(None);
    }

    let backup = write_backup(path, raw.as_bytes()).map_err(failed)?;
    write_sensitive(path, document.to_string().as_bytes()).map_err(failed)?;
    tracing::info!(
        config = %path.display(),
        backup = %backup.display(),
        removed = ?removed,
        "took settings macrod no longer reads out of the config; the original is in the backup"
    );
    Ok(Some(Migration { removed, backup }))
}

/// Copy `contents` to the first free `<path>.bak`, `<path>.bak.2`, ...,
/// readable by its owner only: it holds the harness credential.
fn write_backup(path: &Path, contents: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write as _;

    let mut number = 1;
    loop {
        let mut name = path.as_os_str().to_owned();
        name.push(".bak");
        if number > 1 {
            name.push(format!(".{number}"));
        }
        let backup = PathBuf::from(name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        match options.open(&backup) {
            Ok(mut file) => {
                file.write_all(contents)?;
                file.sync_all()?;
                return Ok(backup);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => number += 1,
            Err(error) => return Err(error),
        }
    }
}

/// Write the config at `path`, readable by its owner only: it holds the
/// harness credential.
pub fn write_sensitive(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
        options.mode(0o600);
        if path.exists() {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    let mut file = options.open(path)?;
    file.write_all(contents)
}

/// macrod's directory, `~/.macrod` (`%USERPROFILE%\.macrod` on Windows):
/// the default config, named profiles, adapter installs, and Herdr storage.
pub fn macrod_directory() -> Option<PathBuf> {
    let home = environment::Home::new();
    let user_profile = environment::Userprofile::new();
    macrod_directory_in_home(
        home.as_ref().and_then(|home| home.value()),
        user_profile.as_ref().and_then(|profile| profile.value()),
    )
}

/// `HOME` wins; `USERPROFILE` is the fallback Windows needs.
fn macrod_directory_in_home(home: Option<&str>, user_profile: Option<&str>) -> Option<PathBuf> {
    [home, user_profile]
        .into_iter()
        .flatten()
        .find(|directory| !directory.is_empty())
        .map(|home| PathBuf::from(home).join(".macrod"))
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
