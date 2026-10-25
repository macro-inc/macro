//! Headless mode for embedders: the serving core without the terminal panel.
//!
//! The Macro desktop app bundles macrod and manages it as a child process.
//! `macrod service` is the contract between them: setup flags configure
//! `macrod.toml` without a TUI, state changes stream to stdout as one JSON
//! object per line, and the process shuts down on SIGTERM, Ctrl-C, or stdin
//! closing (the embedder exited). `macrod detect-agents` and `macrod inspect`
//! are the matching one-shot queries.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rootcause::prelude::ResultExt as _;
use serde::Serialize;
use tokio::io::AsyncReadExt as _;

use crate::config::{Config, HarnessCredentials, IdentityScope};
use crate::daemon::Daemon;
use crate::outbound::pairing::{ClaimStatus, PairingClient};
use crate::tui::agent_catalog::{self, DetectedAgent, PathCommands};
use crate::tui::config_form::{ConfigForm, Setting};

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
}

#[cfg(test)]
mod test;

/// How often the serving core's liveness is re-checked once running.
const DAEMON_WATCH: Duration = Duration::from_secs(5);

/// The ownership scope a service setup asks for.
#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum ServiceScope {
    /// Only the approving user can run agents on this harness.
    Private,
    /// Any of the approving user's teammates can bind agents to it.
    Team,
}

impl From<ServiceScope> for IdentityScope {
    fn from(scope: ServiceScope) -> Self {
        match scope {
            ServiceScope::Private => IdentityScope::Private,
            ServiceScope::Team => IdentityScope::Team,
        }
    }
}

/// Everything `macrod service` accepts.
pub struct ServiceOptions {
    /// Config file; absent uses [`default_config_path`].
    pub config: Option<PathBuf>,
    /// Agent preset id from `detect-agents` to configure.
    pub agent: Option<String>,
    /// Workspace directory sessions run in; created when missing.
    pub workspace: Option<PathBuf>,
    /// Requested display name for the next pairing.
    pub name: Option<String>,
    /// Requested ownership for the next pairing.
    pub scope: Option<ServiceScope>,
    /// Whether the next pairing may enable permission bypass.
    pub allow_permission_bypass: Option<bool>,
}

impl ServiceOptions {
    /// Whether any setup flag was passed, i.e. the config should be (re)written.
    fn wants_setup(&self) -> bool {
        self.agent.is_some()
            || self.workspace.is_some()
            || self.name.is_some()
            || self.scope.is_some()
            || self.allow_permission_bypass.is_some()
    }
}

/// Where the service keeps its config when the embedder names none: the same
/// `~/.macrod` directory that holds adapter installs. Deliberately not the
/// TUI's `./macrod.toml`, so a desktop-managed daemon and a manually run one
/// stay separate harnesses.
pub fn default_config_path() -> Option<PathBuf> {
    environment::Home::new()
        .and_then(|home| home.value().map(PathBuf::from))
        .map(|home| home.join(".macrod").join("macrod.toml"))
}

/// One state change, written to stdout as a single JSON line.
#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum Event {
    /// The config loaded; emitted once at startup and after a setup rewrite.
    Config {
        path: String,
        agent_id: Option<&'static str>,
        agent_name: Option<&'static str>,
        workspace: String,
        paired: bool,
        web_url: String,
    },
    /// A chosen agent's npm ACP adapter is installing.
    InstallingAdapter { package: &'static str },
    /// The adapter install finished.
    AdapterInstalled { package: &'static str },
    /// A pairing is open and waiting for web approval.
    Pairing {
        code: String,
        url: String,
        expires_at: chrono::DateTime<chrono::Utc>,
    },
    /// The pairing was approved and the credential persisted.
    Paired { harness_id: String },
    /// The serving core is up on the stored credential.
    Running { harness_id: String },
    /// The service is exiting on an error; the message is user-facing.
    Fatal { message: String },
}

fn emit(event: &Event) {
    use std::io::Write as _;

    let line = serde_json::to_string(event).expect("service events are plain data");
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}

/// Report a fatal error as the last event before a non-zero exit.
pub fn emit_fatal(message: &str) {
    emit(&Event::Fatal {
        message: fatal_root_message(message),
    });
}

/// Reports render as decorated multi-line trees; an embedder shows one plain
/// sentence, so keep the root message alone.
fn fatal_root_message(message: &str) -> String {
    message
        .lines()
        .map(|line| line.trim().trim_start_matches('●').trim())
        .find(|line| !line.is_empty() && !line.starts_with('╰'))
        .unwrap_or(message)
        .to_owned()
}

/// Run headless until SIGTERM, Ctrl-C, or stdin closes.
pub async fn run(options: ServiceOptions) -> rootcause::Result<()> {
    let shutdown = shutdown_requested();
    tokio::pin!(shutdown);

    let daemon = tokio::select! {
        daemon = start(&options) => daemon?,
        () = &mut shutdown => return Ok(()),
    };

    loop {
        tokio::select! {
            () = &mut shutdown => break,
            () = tokio::time::sleep(DAEMON_WATCH) => {
                if !daemon.is_running() {
                    daemon.stop().await;
                    rootcause::bail!("the serving core stopped unexpectedly");
                }
            }
        }
    }
    daemon.stop().await;
    Ok(())
}

/// Configure, install, pair, and start the serving core.
async fn start(options: &ServiceOptions) -> rootcause::Result<Daemon> {
    let path = config_path(options)?;
    if !path.exists() && !options.wants_setup() {
        rootcause::bail!(
            "no config at {}; pass --agent and --workspace to create one",
            path.display()
        );
    }
    if options.wants_setup() {
        let agent = options.agent.as_deref().map(installed_agent).transpose()?;
        configure(&path, options, agent)?;
    }

    let config = Config::load(&path)?;
    let commands = PathCommands::discover();
    let agent = agent_catalog::detected_for(&config.harness, &commands);
    emit(&Event::Config {
        path: path.display().to_string(),
        agent_id: agent.as_ref().map(|agent| agent.kind.id()),
        agent_name: agent.as_ref().map(|agent| agent.name),
        workspace: config.workspace.path.display().to_string(),
        paired: config
            .credentials
            .as_ref()
            .is_some_and(HarnessCredentials::is_valid),
        web_url: config.macro_api.web_url.clone(),
    });

    if let Some(install) = agent.as_ref().and_then(DetectedAgent::pending_install) {
        emit(&Event::InstallingAdapter {
            package: install.package,
        });
        install
            .run()
            .await
            .map_err(|message| rootcause::report!("{message}"))?;
        emit(&Event::AdapterInstalled {
            package: install.package,
        });
    }

    let credentials = match config
        .credentials
        .clone()
        .filter(HarnessCredentials::is_valid)
    {
        Some(credentials) => credentials,
        None => pair(&path, &config).await?,
    };
    // Pairing persisted into the file; serve what is actually on disk.
    let config = Config::load(&path)?;
    let harness_id = credentials.harness_id.to_string();
    let daemon = Daemon::start(config, credentials, &path).await?;
    emit(&Event::Running { harness_id });
    Ok(daemon)
}

/// Open one pairing and poll it to a claimed credential.
///
/// One code per invocation on purpose: an expired or consumed pairing ends the
/// process, and the embedder decides whether to start over.
async fn pair(path: &Path, config: &Config) -> rootcause::Result<HarnessCredentials> {
    let client = PairingClient::new(config);
    let created = client.start(config).await?;
    emit(&Event::Pairing {
        code: created.code.clone(),
        url: config.macro_api.pairing_approval_url(&created.code),
        expires_at: created.expires_at,
    });
    let interval = Duration::from_secs(created.poll_interval_seconds.max(1));
    loop {
        tokio::time::sleep(interval).await;
        if created.expires_at <= chrono::Utc::now() {
            rootcause::bail!("the pairing code expired before it was approved");
        }
        match client
            .claim(created.pairing_id, &created.device_secret)
            .await?
        {
            ClaimStatus::Pending => {}
            ClaimStatus::Claimed(credentials) => {
                ConfigForm::load(path)?.persist_credentials(&credentials)?;
                emit(&Event::Paired {
                    harness_id: credentials.harness_id.to_string(),
                });
                return Ok(credentials);
            }
            ClaimStatus::Gone(reason) => rootcause::bail!("{reason}"),
        }
    }
}

fn config_path(options: &ServiceOptions) -> rootcause::Result<PathBuf> {
    options
        .config
        .clone()
        .or_else(default_config_path)
        .ok_or_else(|| rootcause::report!("no config path: pass --config or set HOME"))
}

/// Create or edit the config from setup flags, comment-preservingly.
/// `agent` is the resolved launch for `options.agent`, when one was named.
fn configure(
    path: &Path,
    options: &ServiceOptions,
    agent: Option<DetectedAgent>,
) -> rootcause::Result<()> {
    if let Some(workspace) = &options.workspace {
        std::fs::create_dir_all(workspace).context(format!(
            "could not create the workspace at {}",
            workspace.display()
        ))?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context(format!(
            "could not create the config directory at {}",
            parent.display()
        ))?;
    }

    let mut form = if path.exists() {
        let mut form = ConfigForm::load(path)?;
        if let Some(agent) = &agent {
            form.apply_agent(agent);
        }
        if let Some(workspace) = &options.workspace {
            form.apply_text(Setting::Workspace, &workspace.to_string_lossy())
                .map_err(|message| rootcause::report!("{message}"))?;
        }
        form
    } else {
        let agent = agent
            .as_ref()
            .ok_or_else(|| rootcause::report!("creating a config needs --agent"))?;
        let workspace = options
            .workspace
            .as_deref()
            .ok_or_else(|| rootcause::report!("creating a config needs --workspace"))?;
        ConfigForm::create(path, agent, workspace)?;
        ConfigForm::load(path)?
    };

    if let Some(name) = &options.name {
        form.apply_text(Setting::Name, name)
            .map_err(|message| rootcause::report!("{message}"))?;
    }
    if let Some(scope) = options.scope {
        form.set_scope(scope.into());
    }
    if let Some(allowed) = options.allow_permission_bypass {
        form.set_permission_bypass(allowed);
    }
    form.save()
}

fn installed_agent(id: &str) -> rootcause::Result<DetectedAgent> {
    let commands = PathCommands::discover();
    agent_catalog::discover(&commands)
        .into_iter()
        .find(|agent| agent.kind.id() == id)
        .ok_or_else(|| {
            rootcause::report!(
                "agent `{id}` is not installed on this machine; run `macrod detect-agents`"
            )
        })
}

/// Resolve when the embedder or operator asks the service to stop: SIGTERM,
/// Ctrl-C, or stdin reaching EOF (the embedding process exited).
async fn shutdown_requested() {
    let stdin_eof = async {
        let mut stdin = tokio::io::stdin();
        let mut buffer = [0u8; 256];
        loop {
            match stdin.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    };
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("installing a SIGTERM handler never fails");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
            () = stdin_eof => {}
        }
    }
    #[cfg(not(unix))]
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = stdin_eof => {}
    }
}

/// The `detect-agents` answer: installed agents in product-preference order.
#[derive(Debug, Serialize)]
struct DetectedAgents {
    agents: Vec<DetectedAgentReport>,
}

/// One installed agent, as reported to an embedder.
#[derive(Debug, Serialize)]
struct DetectedAgentReport {
    /// Stable preset id, accepted by `service --agent`.
    id: &'static str,
    /// Human-readable name.
    name: &'static str,
    /// Short explanation for adapter-backed launchers.
    note: Option<&'static str>,
    /// Whether selecting this agent still downloads an ACP adapter first.
    needs_install: bool,
}

/// The ACP agents installed on this machine, as a JSON document.
pub fn detect_agents_json() -> String {
    let commands = PathCommands::discover();
    let agents = agent_catalog::discover(&commands)
        .into_iter()
        .map(|agent| DetectedAgentReport {
            id: agent.kind.id(),
            name: agent.name,
            note: agent.note,
            needs_install: agent.pending_install().is_some(),
        })
        .collect();
    serde_json::to_string(&DetectedAgents { agents }).expect("agent reports are plain data")
}

/// The `inspect` answer: the service config's state, without running anything.
#[derive(Debug, Serialize)]
struct Inspection {
    config_path: String,
    exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    paired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    harness_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_name: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    web_url: Option<String>,
}

/// Inspect the config at `path` (or the default location) as a JSON document.
pub fn inspect_json(config: Option<PathBuf>) -> rootcause::Result<String> {
    let path = config_path(&ServiceOptions {
        config,
        agent: None,
        workspace: None,
        name: None,
        scope: None,
        allow_permission_bypass: None,
    })?;
    let mut inspection = Inspection {
        config_path: path.display().to_string(),
        exists: path.exists(),
        error: None,
        paired: false,
        harness_id: None,
        agent_id: None,
        agent_name: None,
        workspace: None,
        web_url: None,
    };
    if inspection.exists {
        match Config::load(&path) {
            Ok(config) => {
                let commands = PathCommands::discover();
                let agent = agent_catalog::detected_for(&config.harness, &commands);
                let credentials = config
                    .credentials
                    .as_ref()
                    .filter(|credentials| credentials.is_valid());
                inspection.paired = credentials.is_some();
                inspection.harness_id =
                    credentials.map(|credentials| credentials.harness_id.to_string());
                inspection.agent_id = agent.as_ref().map(|agent| agent.kind.id());
                inspection.agent_name = agent.as_ref().map(|agent| agent.name);
                inspection.workspace = Some(config.workspace.path.display().to_string());
                inspection.web_url = Some(config.macro_api.web_url.clone());
            }
            Err(error) => inspection.error = Some(format!("{error}")),
        }
    }
    Ok(serde_json::to_string(&inspection).expect("inspections are plain data"))
}
