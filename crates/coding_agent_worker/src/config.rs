//! The daemon's one input: `macrod.toml`, this machine's local config - the
//! harness it runs, its workspace, native Herdr defaults, and the pairing
//! credential. The TUI and `macrod service` share one file,
//! `~/.macrod/macrod.toml` ([`default_config_path`]). See
//! `config.example.toml` at the crate root.
//!
//! Runtime settings - the name, ownership, and permission bypass - live on the
//! web at Settings → Agents → Runtimes, not here. Pairing (press `p` in the
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
    /// Ignored: runtime settings that moved to the web. Accepted so older
    /// configs still parse; [`Config::load`] warns about it.
    #[serde(default)]
    identity: Option<toml::Table>,
    /// Ignored: the webhook listener the daemon no longer runs. Accepted so
    /// older configs still parse. The daemon listens over SSE.
    #[serde(default)]
    #[expect(dead_code, reason = "accepted only so existing configs still parse")]
    server: Option<toml::Table>,
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

/// Whether the approved harness is private to its owner or shared with a team,
/// as recorded when pairing completed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessScope {
    /// Owned by one user.
    User,
    /// Owned by a team.
    Team,
}

/// The credential pairing minted for this daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HarnessCredentials {
    /// The registered harness this daemon serves.
    pub harness_id: HarnessId,
    /// The bearer token (`mhns_...`).
    pub token: String,
    /// The approved harness ownership scope.
    pub scope: HarnessScope,
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
        format!("{base}/settings/harness")
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
    /// Load and parse the config at `path`.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let raw = std::fs::read_to_string(path).map_err(|source| ConfigError::Io {
            path: path.to_owned(),
            source,
        })?;
        let config: Self = toml::from_str(&raw).map_err(|source| ConfigError::Parse {
            path: path.to_owned(),
            source,
        })?;
        if let Some(identity) = &config.identity {
            let keys = identity
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(", ");
            tracing::warn!(
                path = %path.display(),
                ignored_keys = %keys,
                "ignoring the [identity] table in macrod.toml: a runtime's name, ownership, and \
                 permission bypass are now set on the web at Settings → Agents → Runtimes"
            );
        }
        Ok(config)
    }
}

/// The one config location shared by the TUI and `macrod service`:
/// `~/.macrod/macrod.toml` (`%USERPROFILE%\.macrod\macrod.toml` on Windows),
/// next to adapter installs and Herdr storage.
pub fn default_config_path() -> Option<PathBuf> {
    let home = environment::Home::new();
    let user_profile = environment::Userprofile::new();
    config_path_in_home(
        home.as_ref().and_then(|home| home.value()),
        user_profile.as_ref().and_then(|profile| profile.value()),
    )
}

/// `HOME` wins; `USERPROFILE` is the fallback Windows needs.
fn config_path_in_home(home: Option<&str>, user_profile: Option<&str>) -> Option<PathBuf> {
    [home, user_profile]
        .into_iter()
        .flatten()
        .find(|directory| !directory.is_empty())
        .map(|home| PathBuf::from(home).join(".macrod").join("macrod.toml"))
}

/// Move a config left in the working directory by an older release
/// (`./macrod.toml`, plus its sibling `macrod.webhook-state.json`) to
/// `target`, the default location.
///
/// When both exist, `target` wins and the working-directory copy is left alone.
pub fn adopt_working_directory_config(target: &Path, legacy: &Path) -> std::io::Result<()> {
    if !legacy.exists() {
        return Ok(());
    }
    if target.exists() {
        tracing::warn!(
            ignored = %legacy.display(),
            config = %target.display(),
            "ignoring the macrod.toml in the working directory; using the default config"
        );
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    move_file(legacy, target)?;
    let legacy_state = legacy.with_extension("webhook-state.json");
    if legacy_state.exists() {
        move_file(&legacy_state, &target.with_extension("webhook-state.json"))?;
    }
    tracing::info!(
        from = %legacy.display(),
        to = %target.display(),
        "moved macrod.toml from the working directory to the default config location"
    );
    Ok(())
}

/// Rename, or copy and remove when the two paths are on different filesystems.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)?;
    std::fs::remove_file(from)
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

/// Take the advisory lock `<config>.lock` beside `config`, failing fast when
/// another macrod already holds it.
pub fn lock(config: &Path) -> Result<ConfigLock, LockError> {
    let mut name = config.as_os_str().to_owned();
    name.push(".lock");
    let lock_path = PathBuf::from(name);
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
