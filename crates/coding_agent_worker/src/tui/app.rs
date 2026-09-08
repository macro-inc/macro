#[cfg(test)]
mod test;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use harnesses::domain::models::CreatedPairing;
use tui_input::Input;

use super::agent_catalog::{self, DetectedAgent, PathCommands};
use super::api::{HarnessSelfApi, Snapshot};
use super::config_form::{ConfigForm, SETTINGS, Setting};
use super::input::handle_text_input;
use super::logging::LogBuffer;
use super::platform::{BrowserTarget, copy_to_clipboard};
use super::process;
use crate::config::{Config, HarnessCredentials};
use crate::daemon::Daemon;
use crate::outbound::pairing::{ClaimStatus, PairingClient};

/// How often the dashboard re-reads the server.
pub(crate) const REFRESH_EVERY: Duration = Duration::from_secs(3);

/// Which tab is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tab {
    Overview,
    Sessions,
    Config,
    Logs,
}

impl Tab {
    pub(crate) const ALL: [Tab; 4] = [Tab::Overview, Tab::Sessions, Tab::Config, Tab::Logs];

    pub(crate) fn title(self) -> &'static str {
        match self {
            Tab::Overview => "Overview",
            Tab::Sessions => "Sessions",
            Tab::Config => "Config",
            Tab::Logs => "Logs",
        }
    }

    fn next(self) -> Tab {
        match self {
            Tab::Overview => Tab::Sessions,
            Tab::Sessions => Tab::Config,
            Tab::Config => Tab::Logs,
            Tab::Logs => Tab::Overview,
        }
    }

    fn previous(self) -> Tab {
        match self {
            Tab::Overview => Tab::Logs,
            Tab::Sessions => Tab::Overview,
            Tab::Config => Tab::Sessions,
            Tab::Logs => Tab::Config,
        }
    }
}

/// A modal claiming the keyboard, when one is up.
pub(crate) enum Mode {
    /// Browsing; keys act on the current tab.
    Normal,
    /// Editing one config setting's value.
    EditSetting {
        /// Index into [`SETTINGS`].
        index: usize,
        /// The text being typed.
        buffer: Input,
    },
    /// Choosing from the ACP agents installed on this machine.
    AgentPicker {
        /// Selected agent index.
        selected: usize,
    },
    /// Entering an arbitrary ACP command line.
    CustomAgent { buffer: Input },
    /// Confirming harness removal.
    ConfirmDelete,
    /// A pairing in flight: code shown, waiting for approval.
    Pairing {
        /// The open pairing.
        created: CreatedPairing,
        /// When the claim was last polled.
        last_poll: Instant,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApplyConfig {
    Now,
    NextPairing,
}

/// Everything the UI renders from.
pub(crate) struct App {
    pub(crate) config_path: PathBuf,
    pub(crate) config: Config,
    pub(crate) credentials: Option<HarnessCredentials>,
    pub(crate) snapshot: Snapshot,
    /// This process's pid - the TUI and the daemon are this one process.
    pub(crate) pid: u32,
    /// The spawned harness child, when serving and one is found.
    pub(crate) harness_process: Option<process::Child>,
    pub(crate) tab: Tab,
    pub(crate) mode: Mode,
    pub(crate) selected_setting: usize,
    pub(crate) form: ConfigForm,
    pub(crate) agents: Vec<DetectedAgent>,
    pub(crate) status: Option<(String, bool)>,
    pub(crate) spinner: usize,
    pub(crate) logs: LogBuffer,
    pub(crate) daemon: Option<Daemon>,
    pub(crate) pending_browser: Option<BrowserTarget>,
    last_refresh: Option<Instant>,
    pub(crate) quit: bool,
}

impl App {
    pub(crate) fn load(config_path: &Path, logs: LogBuffer) -> rootcause::Result<Self> {
        let config = Config::load(config_path)?;
        let credentials = config
            .credentials
            .clone()
            .filter(HarnessCredentials::is_valid);
        let form = ConfigForm::load(config_path)?;
        let agents = agent_catalog::discover(&PathCommands::discover());
        Ok(Self {
            config_path: config_path.to_owned(),
            config,
            credentials,
            snapshot: Snapshot::default(),
            pid: std::process::id(),
            harness_process: None,
            tab: Tab::Overview,
            mode: Mode::Normal,
            selected_setting: 0,
            form,
            agents,
            status: None,
            spinner: 0,
            logs,
            daemon: None,
            pending_browser: None,
            last_refresh: None,
            quit: false,
        })
    }

    /// Whether the in-process serving core is up.
    pub(crate) fn serving(&self) -> bool {
        self.daemon.as_ref().is_some_and(Daemon::is_running)
    }

    /// (Re)start the serving core on the current config and credential.
    pub(crate) async fn restart_daemon(&mut self) -> bool {
        if let Some(daemon) = self.daemon.take() {
            daemon.stop().await;
        }
        let Some(credentials) = self.credentials.clone() else {
            return false;
        };
        match Daemon::start(self.config.clone(), credentials, &self.config_path).await {
            Ok(daemon) => {
                self.daemon = Some(daemon);
                true
            }
            Err(error) => {
                self.fail(format!("daemon failed to start: {error}"));
                false
            }
        }
    }

    /// Stop the serving core, if it is up.
    pub(crate) async fn stop_daemon(&mut self) {
        if let Some(daemon) = self.daemon.take() {
            daemon.stop().await;
        }
    }

    /// The approval URL of the pairing in flight, when one is.
    fn pairing_url(&self) -> Option<String> {
        match &self.mode {
            Mode::Pairing { created, .. } => {
                Some(self.config.macro_api.pairing_approval_url(&created.code))
            }
            _ => None,
        }
    }

    pub(crate) fn paired(&self) -> bool {
        self.credentials.is_some()
    }

    fn api(&self) -> Option<HarnessSelfApi> {
        self.credentials
            .as_ref()
            .map(|credentials| HarnessSelfApi::new(&self.config, credentials))
    }

    pub(crate) fn ok(&mut self, message: impl Into<String>) {
        self.status = Some((message.into(), false));
    }

    pub(crate) fn fail(&mut self, message: impl Into<String>) {
        self.status = Some((message.into(), true));
    }

    pub(crate) async fn refresh(&mut self) {
        // Local process facts refresh with the dashboard, not with the network.
        self.harness_process = if self.serving() {
            process::harness_child(&self.config.harness.command)
        } else {
            None
        };
        let Some(api) = self.api() else {
            self.snapshot = Snapshot::default();
            return;
        };
        match api.snapshot().await {
            Ok(snapshot) => {
                self.snapshot = snapshot;
                self.last_refresh = Some(Instant::now());
            }
            Err(error) => self.fail(format!("refresh failed: {error}")),
        }
    }

    pub(crate) async fn maybe_refresh(&mut self) {
        let due = self
            .last_refresh
            .is_none_or(|last| last.elapsed() >= REFRESH_EVERY);
        if due {
            self.refresh().await;
        }
    }

    pub(crate) async fn start_pairing(&mut self) {
        // Re-read the config so an edit saved a moment ago (a new name or
        // scope) is what this pairing asks for.
        match Config::load(&self.config_path) {
            Ok(config) => self.config = config,
            Err(error) => return self.fail(format!("config reload failed: {error}")),
        }
        let client = PairingClient::new(&self.config);
        match client.start(&self.config).await {
            Ok(created) => {
                // The approval page pre-fills the code, so opening the
                // browser is usually the whole remaining gesture.
                let url = self.config.macro_api.pairing_approval_url(&created.code);
                self.pending_browser = Some(BrowserTarget::Pairing(url));
                self.mode = Mode::Pairing {
                    created,
                    last_poll: Instant::now(),
                };
            }
            Err(error) => self.fail(format!("pairing failed to start: {error}")),
        }
    }

    pub(crate) async fn poll_pairing(&mut self) {
        // Copy what the poll needs out of the mode first, so the network call
        // below is free to report back into `self`.
        let (pairing_id, device_secret) = {
            let Mode::Pairing { created, last_poll } = &mut self.mode else {
                return;
            };
            let interval = Duration::from_secs(created.poll_interval_seconds.max(1));
            if last_poll.elapsed() < interval {
                return;
            }
            *last_poll = Instant::now();
            if created.expires_at <= chrono::Utc::now() {
                self.mode = Mode::Normal;
                return self.fail("the pairing expired before it was approved");
            }
            (created.pairing_id, created.device_secret.clone())
        };
        let client = PairingClient::new(&self.config);
        match client.claim(pairing_id, &device_secret).await {
            Ok(ClaimStatus::Pending) => {}
            Ok(ClaimStatus::Claimed(credentials)) => {
                if let Err(error) = self.form.persist_credentials(&credentials) {
                    self.mode = Mode::Normal;
                    return self.fail(format!("could not save credentials: {error}"));
                }
                match Config::load(&self.config_path) {
                    Ok(config) => self.config = config,
                    Err(error) => {
                        self.mode = Mode::Normal;
                        return self.fail(format!("could not reload credentials: {error}"));
                    }
                }
                self.credentials = Some(credentials);
                self.mode = Mode::Normal;
                self.restart_daemon().await;
                if self.serving() {
                    self.ok("paired and serving");
                }
                self.refresh().await;
            }
            Ok(ClaimStatus::Gone(reason)) => {
                self.mode = Mode::Normal;
                self.fail(reason);
            }
            Err(error) => {
                self.mode = Mode::Normal;
                self.fail(format!("pairing poll failed: {error}"));
            }
        }
    }

    async fn delete_harness(&mut self) {
        let Some(api) = self.api() else {
            return self.fail("not paired");
        };
        if let Err(error) = api.delete_self().await {
            return self.fail(format!("{error}"));
        }
        // The credential is dead either way; stop serving with it and drop
        // the local state that belonged to it so the next pairing starts
        // clean.
        self.stop_daemon().await;
        if let Err(error) = self.form.clear_credentials() {
            return self.fail(format!(
                "harness removed, but credentials could not be cleared: {error}"
            ));
        }
        match Config::load(&self.config_path) {
            Ok(config) => self.config = config,
            Err(error) => {
                return self.fail(format!("credentials cleared, but reload failed: {error}"));
            }
        }
        let _ = std::fs::remove_file(self.config_path.with_extension("webhook-state.json"));
        self.credentials = None;
        self.snapshot = Snapshot::default();
        self.ok("harness removed - press p to pair again");
    }

    pub(crate) async fn on_key(&mut self, key: KeyEvent) {
        if key.kind != KeyEventKind::Press {
            return;
        }
        // Ctrl-C always quits, whatever is up.
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.quit = true;
            return;
        }

        match self.mode {
            Mode::Normal => self.on_normal_key(key).await,
            Mode::ConfirmDelete => {
                self.mode = Mode::Normal;
                if matches!(key.code, KeyCode::Char('y') | KeyCode::Char('Y')) {
                    self.delete_harness().await;
                }
            }
            Mode::Pairing { .. } => {
                match key.code {
                    KeyCode::Esc => {
                        self.mode = Mode::Normal;
                        self.ok("pairing abandoned; the code expires on its own");
                    }
                    KeyCode::Char('o') => {
                        let url = self.pairing_url();
                        if let Some(url) = url {
                            self.pending_browser = Some(BrowserTarget::Pairing(url));
                        }
                    }
                    KeyCode::Char('c') => {
                        let code = match &self.mode {
                            Mode::Pairing { created, .. } => Some(created.code.clone()),
                            _ => None,
                        };
                        if let Some(code) = code {
                            if copy_to_clipboard(&code) {
                                self.ok(format!("copied {code}"));
                            } else {
                                self.fail("could not access the system clipboard; select the code to copy it");
                            }
                        }
                    }
                    _ => {}
                }
            }
            Mode::EditSetting { .. } => self.on_edit_key(key).await,
            Mode::AgentPicker { .. } => self.on_agent_picker_key(key).await,
            Mode::CustomAgent { .. } => self.on_custom_agent_key(key).await,
        }
    }

    async fn on_edit_key(&mut self, key: KeyEvent) {
        let Mode::EditSetting { index, buffer } = &mut self.mode else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.mode = Mode::Normal,
            KeyCode::Backspace => {
                handle_text_input(buffer, key);
            }
            KeyCode::Enter => {
                let index = *index;
                let input = buffer.value().to_owned();
                self.mode = Mode::Normal;
                self.commit_edit(index, input).await;
            }
            _ => handle_text_input(buffer, key),
        }
    }

    async fn commit_edit(&mut self, index: usize, input: String) {
        let setting = SETTINGS[index];
        if let Err(message) = self.form.apply_text(setting, &input) {
            return self.fail(message);
        }
        let apply = match setting {
            Setting::Workspace => ApplyConfig::Now,
            Setting::Name => ApplyConfig::NextPairing,
            Setting::Agent | Setting::Scope => unreachable!("not edited as text"),
        };
        self.save_config(apply).await;
    }

    async fn on_agent_picker_key(&mut self, key: KeyEvent) {
        let Mode::AgentPicker { selected } = &mut self.mode else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.mode = Mode::Normal,
            KeyCode::Up | KeyCode::Char('k') => *selected = selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => {
                *selected = (*selected + 1).min(self.agents.len());
            }
            KeyCode::Char('?') => self.pending_browser = Some(BrowserTarget::BringYourOwn),
            KeyCode::Enter => {
                if *selected == self.agents.len() {
                    let command = shell_words::join(
                        std::iter::once(self.config.harness.command.as_str())
                            .chain(self.config.harness.args.iter().map(String::as_str)),
                    );
                    self.mode = Mode::CustomAgent {
                        buffer: command.into(),
                    };
                } else {
                    let agent = self.agents.get(*selected).cloned();
                    self.mode = Mode::Normal;
                    if let Some(agent) = agent {
                        self.form.apply_agent(&agent);
                        self.save_config(ApplyConfig::Now).await;
                    }
                }
            }
            _ => {}
        }
    }

    async fn on_custom_agent_key(&mut self, key: KeyEvent) {
        let Mode::CustomAgent { buffer } = &mut self.mode else {
            return;
        };
        match key.code {
            KeyCode::Esc => {
                self.mode = Mode::AgentPicker {
                    selected: self.agents.len(),
                };
            }
            KeyCode::Enter => match agent_catalog::custom(buffer.value()) {
                Ok(agent) => {
                    self.mode = Mode::Normal;
                    self.form.apply_agent(&agent);
                    self.save_config(ApplyConfig::Now).await;
                }
                Err(error) => self.fail(error),
            },
            _ => handle_text_input(buffer, key),
        }
    }

    async fn save_config(&mut self, apply: ApplyConfig) {
        match self.form.save() {
            Ok(()) => match Config::load(&self.config_path) {
                Ok(config) => {
                    self.config = config;
                    // The core reads config at start, so a save while serving
                    // means a restart to apply it.
                    if apply == ApplyConfig::Now && self.paired() {
                        if self.restart_daemon().await {
                            self.ok("saved and applied");
                        }
                    } else if apply == ApplyConfig::NextPairing && self.paired() {
                        self.ok("saved; applies at next pairing");
                    } else {
                        self.ok("saved");
                    }
                }
                Err(error) => self.fail(format!("saved, but reload failed: {error}")),
            },
            Err(error) => {
                // Reload the form so the rejected edit does not linger in the
                // document.
                if let Ok(form) = ConfigForm::load(&self.config_path) {
                    self.form = form;
                }
                self.fail(format!("{error}"));
            }
        }
    }

    async fn on_normal_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('q') => self.quit = true,
            KeyCode::Tab => self.tab = self.tab.next(),
            KeyCode::Right | KeyCode::Char('l') => self.tab = self.tab.next(),
            KeyCode::Left | KeyCode::Char('h') => self.tab = self.tab.previous(),
            KeyCode::Char('1') => self.tab = Tab::Overview,
            KeyCode::Char('2') => self.tab = Tab::Sessions,
            KeyCode::Char('3') => self.tab = Tab::Config,
            KeyCode::Char('4') => self.tab = Tab::Logs,
            KeyCode::Char('r') => {
                self.last_refresh = None;
                self.maybe_refresh().await;
            }
            KeyCode::Char('p') => self.start_pairing().await,
            KeyCode::Char('d') if self.paired() => self.mode = Mode::ConfirmDelete,
            KeyCode::Up | KeyCode::Char('k') if self.tab == Tab::Config => {
                self.selected_setting = self.selected_setting.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') if self.tab == Tab::Config => {
                self.selected_setting = (self.selected_setting + 1).min(SETTINGS.len() - 1);
            }
            KeyCode::Enter if self.tab == Tab::Config => match SETTINGS[self.selected_setting] {
                Setting::Agent => {
                    let selected = self
                        .agents
                        .iter()
                        .position(|agent| {
                            agent.launch.command == self.config.harness.command
                                && agent.launch.args == self.config.harness.args
                        })
                        .unwrap_or(self.agents.len());
                    self.mode = Mode::AgentPicker { selected };
                }
                Setting::Scope => {
                    self.form.toggle_scope(&self.config);
                    self.save_config(ApplyConfig::NextPairing).await;
                }
                setting @ (Setting::Workspace | Setting::Name) => {
                    self.mode = Mode::EditSetting {
                        index: self.selected_setting,
                        buffer: self.form.edit_value(setting).into(),
                    };
                }
            },
            _ => {}
        }
    }
}
