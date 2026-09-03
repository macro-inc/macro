//! The macrod control panel: one process that serves and shows itself.
//!
//! `macrod` runs the serving core (SSE listener, harness bridge) inside a
//! terminal UI that shows what the server knows about this harness - its
//! registration, the agents bound to it, their sessions, and the daemon's
//! own logs - and drives its lifecycle: edit `macro.toml`, pair (or re-pair,
//! restarting the core on the new credential), and retire the harness.

mod api;
mod config_form;
mod process;
mod ui;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crossterm::event::{Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use harnesses::domain::models::CreatedPairing;
use rootcause::prelude::ResultExt as _;

use crate::config::Config;
use crate::daemon::Daemon;
use crate::outbound::credentials::{CredentialStore as _, FileCredentialStore, HarnessCredentials};
use crate::outbound::pairing::{ClaimStatus, PairingClient};

use api::{HarnessSelfApi, Snapshot};
use config_form::{ConfigForm, FIELDS, FieldKind};

/// How often the dashboard re-reads the server.
const REFRESH_EVERY: Duration = Duration::from_secs(3);
/// Spinner cadence and input latency budget.
const TICK: Duration = Duration::from_millis(120);

/// The daemon's own log lines, rendered by the Logs tab.
///
/// The TUI owns the terminal, so tracing must not write to it; this is the
/// sink the subscriber writes into instead.
#[derive(Clone, Default)]
pub struct LogBuffer {
    lines: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
}

impl LogBuffer {
    const CAPACITY: usize = 500;

    /// Install the global tracing subscriber writing into a fresh buffer.
    pub fn install() -> Self {
        let buffer = Self::default();
        let sink = buffer.clone();
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .with_ansi(false)
            .with_writer(move || sink.clone())
            .init();
        buffer
    }

    /// The most recent lines, oldest first.
    pub(crate) fn tail(&self, count: usize) -> Vec<String> {
        let lines = self.lines.lock().expect("log buffer lock");
        lines.iter().rev().take(count).rev().cloned().collect()
    }
}

impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let mut lines = self.lines.lock().expect("log buffer lock");
        for line in String::from_utf8_lossy(bytes).lines() {
            if line.trim().is_empty() {
                continue;
            }
            if lines.len() == Self::CAPACITY {
                lines.pop_front();
            }
            lines.push_back(line.to_owned());
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Which tab is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tab {
    Overview,
    Sessions,
    Config,
    Logs,
}

impl Tab {
    const ALL: [Tab; 4] = [Tab::Overview, Tab::Sessions, Tab::Config, Tab::Logs];

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
}

/// A modal claiming the keyboard, when one is up.
pub(crate) enum Mode {
    /// Browsing; keys act on the current tab.
    Normal,
    /// Editing one config field's value.
    EditField {
        /// Index into [`FIELDS`].
        index: usize,
        /// The text being typed.
        buffer: String,
    },
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
    pub(crate) selected_field: usize,
    pub(crate) form: ConfigForm,
    pub(crate) status: Option<(String, bool)>,
    pub(crate) spinner: usize,
    pub(crate) logs: LogBuffer,
    pub(crate) daemon: Option<Daemon>,
    last_refresh: Option<Instant>,
    quit: bool,
}

impl App {
    fn load(config_path: &Path, logs: LogBuffer) -> rootcause::Result<Self> {
        let config = Config::load(config_path)?;
        let credentials = FileCredentialStore::for_config(config_path).load()?;
        let form = ConfigForm::load(config_path)?;
        Ok(Self {
            config_path: config_path.to_owned(),
            config,
            credentials,
            snapshot: Snapshot::default(),
            pid: std::process::id(),
            harness_process: None,
            tab: Tab::Overview,
            mode: Mode::Normal,
            selected_field: 0,
            form,
            status: None,
            spinner: 0,
            logs,
            daemon: None,
            last_refresh: None,
            quit: false,
        })
    }

    /// Whether the in-process serving core is up.
    pub(crate) fn serving(&self) -> bool {
        self.daemon.as_ref().is_some_and(Daemon::is_running)
    }

    /// (Re)start the serving core on the current config and credential.
    async fn restart_daemon(&mut self) {
        if let Some(daemon) = self.daemon.take() {
            daemon.stop().await;
        }
        let Some(credentials) = self.credentials.clone() else {
            return;
        };
        match Daemon::start(self.config.clone(), credentials, &self.config_path).await {
            Ok(daemon) => self.daemon = Some(daemon),
            Err(error) => self.fail(format!("daemon failed to start: {error}")),
        }
    }

    /// Stop the serving core, if it is up.
    async fn stop_daemon(&mut self) {
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

    fn ok(&mut self, message: impl Into<String>) {
        self.status = Some((message.into(), false));
    }

    fn fail(&mut self, message: impl Into<String>) {
        self.status = Some((message.into(), true));
    }

    async fn refresh(&mut self) {
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

    async fn maybe_refresh(&mut self) {
        let due = self
            .last_refresh
            .is_none_or(|last| last.elapsed() >= REFRESH_EVERY);
        if due {
            self.refresh().await;
        }
    }

    async fn start_pairing(&mut self) {
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
                open_in_browser(&url);
                self.mode = Mode::Pairing {
                    created,
                    last_poll: Instant::now(),
                };
            }
            Err(error) => self.fail(format!("pairing failed to start: {error}")),
        }
    }

    async fn poll_pairing(&mut self) {
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
                let store = FileCredentialStore::for_config(&self.config_path);
                if let Err(error) = store.save(&credentials) {
                    self.mode = Mode::Normal;
                    return self.fail(format!("could not save credentials: {error}"));
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
        let _ = std::fs::remove_file(crate::outbound::credentials::credentials_path(
            &self.config_path,
        ));
        let _ = std::fs::remove_file(self.config_path.with_extension("webhook-state.json"));
        self.credentials = None;
        self.snapshot = Snapshot::default();
        self.ok("harness removed - press p to pair again");
    }

    async fn on_key(&mut self, key: KeyEvent) {
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
            Mode::Pairing { .. } => match key.code {
                KeyCode::Esc => {
                    self.mode = Mode::Normal;
                    self.ok("pairing abandoned; the code expires on its own");
                }
                KeyCode::Char('o') => {
                    let url = self.pairing_url();
                    if let Some(url) = url {
                        if open_in_browser(&url) {
                            self.ok("opened the approval page");
                        } else {
                            self.fail("could not open a browser; use the printed link");
                        }
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
                            self.fail("no clipboard tool found; select the code to copy it");
                        }
                    }
                }
                _ => {}
            },
            Mode::EditField { .. } => self.on_edit_key(key).await,
        }
    }

    async fn on_edit_key(&mut self, key: KeyEvent) {
        let Mode::EditField { index, buffer } = &mut self.mode else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.mode = Mode::Normal,
            KeyCode::Backspace => {
                buffer.pop();
            }
            KeyCode::Char(ch) => buffer.push(ch),
            KeyCode::Enter => {
                let index = *index;
                let input = buffer.clone();
                self.mode = Mode::Normal;
                self.commit_edit(index, input).await;
            }
            _ => {}
        }
    }

    async fn commit_edit(&mut self, index: usize, input: String) {
        let field = &FIELDS[index];
        if let Err(message) = self.form.apply(field, &input) {
            return self.fail(message);
        }
        match self.form.save() {
            Ok(()) => match Config::load(&self.config_path) {
                Ok(config) => {
                    self.config = config;
                    // The core reads config at start, so a save while serving
                    // means a restart to apply it.
                    if self.serving() {
                        self.restart_daemon().await;
                        self.ok("saved and applied");
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
                self.selected_field = self.selected_field.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') if self.tab == Tab::Config => {
                self.selected_field = (self.selected_field + 1).min(FIELDS.len() - 1);
            }
            KeyCode::Enter if self.tab == Tab::Config => {
                let field = &FIELDS[self.selected_field];
                if field.kind == FieldKind::Scope {
                    // Toggle rather than type: the only values are the two.
                    let next = if self.form.display(field) == "team" {
                        "private"
                    } else {
                        "team"
                    };
                    if self.form.apply(field, next).is_ok() {
                        match self.form.save() {
                            Ok(()) => self.ok(format!("scope: {next} (applies at next pairing)")),
                            Err(error) => self.fail(format!("{error}")),
                        }
                    }
                } else {
                    self.mode = Mode::EditField {
                        index: self.selected_field,
                        buffer: self.form.display(field),
                    };
                }
            }
            _ => {}
        }
    }
}

/// Run the control panel - and the daemon inside it - until the user quits.
pub async fn run(config_path: &Path, logs: LogBuffer) -> rootcause::Result<()> {
    let mut app = App::load(config_path, logs)?;

    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel();
    // A dedicated thread owns the blocking crossterm read; the loop below
    // stays async and free to poll the network.
    std::thread::spawn(move || {
        while let Ok(event) = crossterm::event::read() {
            if input_tx.send(event).is_err() {
                return;
            }
        }
    });

    let mut terminal = ratatui::init();
    let outcome = run_loop(&mut terminal, &mut app, &mut input_rx).await;
    ratatui::restore();
    outcome
}

/// Open a URL in the default browser, reporting whether the spawn worked.
fn open_in_browser(url: &str) -> bool {
    #[cfg(target_os = "macos")]
    let launcher = "open";
    #[cfg(not(target_os = "macos"))]
    let launcher = "xdg-open";
    std::process::Command::new(launcher)
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}

/// Put text on the system clipboard, reporting whether a tool was found.
fn copy_to_clipboard(text: &str) -> bool {
    use std::io::Write as _;
    #[cfg(target_os = "macos")]
    let candidates: &[&[&str]] = &[&["pbcopy"]];
    #[cfg(not(target_os = "macos"))]
    let candidates: &[&[&str]] = &[&["wl-copy"], &["xclip", "-selection", "clipboard"]];
    for candidate in candidates {
        let spawned = std::process::Command::new(candidate[0])
            .args(&candidate[1..])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        if let Ok(mut child) = spawned {
            let wrote = child
                .stdin
                .take()
                .and_then(|mut stdin| stdin.write_all(text.as_bytes()).ok())
                .is_some();
            if wrote && child.wait().is_ok_and(|status| status.success()) {
                return true;
            }
        }
    }
    false
}

async fn run_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    input: &mut tokio::sync::mpsc::UnboundedReceiver<TermEvent>,
) -> rootcause::Result<()> {
    let mut tick = tokio::time::interval(TICK);
    // Paired already? Start serving before the first frame.
    if app.paired() {
        app.restart_daemon().await;
    }
    app.refresh().await;

    loop {
        terminal
            .draw(|frame| ui::render(frame, app))
            .context("failed to draw the terminal UI")?;

        tokio::select! {
            event = input.recv() => {
                match event {
                    Some(TermEvent::Key(key)) => app.on_key(key).await,
                    Some(_) => {}
                    None => return Ok(()),
                }
            }
            _ = tick.tick() => {
                app.spinner = app.spinner.wrapping_add(1);
                app.poll_pairing().await;
                if matches!(app.mode, Mode::Normal) {
                    app.maybe_refresh().await;
                }
            }
        }

        if app.quit {
            app.stop_daemon().await;
            return Ok(());
        }
    }
}
