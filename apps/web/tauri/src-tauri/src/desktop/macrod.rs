//! Management of the bundled macrod daemon: the local agent runtime that
//! lets users run coding agents on this machine.
//!
//! The desktop app ships the `macrod` binary next to its own executable and
//! supervises it as a child process in `macrod service` mode. That mode
//! reports state changes as one JSON object per line on stdout; this module
//! folds those lines into a [`MacrodStatus`] snapshot, re-emits every change
//! to the webview as a `macrod-status` event, and exposes commands to detect
//! installed agents, start or stop the daemon, and read the snapshot.
//!
//! GUI apps on macOS inherit launchd's minimal `PATH`, where user-installed
//! CLIs (`claude`, `codex`, `npm`) are invisible. Every macrod invocation runs
//! with the user's login-shell `PATH` so detection matches what a terminal
//! would see.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncBufReadExt as _;

/// The webview event carrying each [`MacrodStatus`] change.
const STATUS_EVENT: &str = "macrod-status";

/// Where the daemon lifecycle currently stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum MacrodPhase {
    Stopped,
    Starting,
    InstallingAdapter,
    Pairing,
    Running,
    Error,
}

impl Default for MacrodPhase {
    fn default() -> Self {
        Self::Stopped
    }
}

/// The daemon state snapshot the frontend renders from.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MacrodStatus {
    pub(crate) phase: MacrodPhase,
    /// Agent preset id from the service config, e.g. `claude-code`.
    pub(crate) agent_id: Option<String>,
    /// Human-readable agent name from the service config.
    pub(crate) agent_name: Option<String>,
    /// Workspace directory sessions run in.
    pub(crate) workspace: Option<String>,
    /// Open pairing code awaiting approval, `XXXX-XXXX`.
    pub(crate) pairing_code: Option<String>,
    /// When the open pairing expires (RFC 3339).
    pub(crate) pairing_expires_at: Option<String>,
    /// The registered harness once paired.
    pub(crate) harness_id: Option<String>,
    /// The last fatal error, kept until the next start.
    pub(crate) last_error: Option<String>,
}

impl MacrodStatus {
    /// Fold one service event line into this snapshot.
    fn apply(&mut self, event: &serde_json::Value) {
        let text = |key: &str| {
            event
                .get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        };
        match event.get("event").and_then(serde_json::Value::as_str) {
            Some("config") => {
                self.agent_id = text("agent_id");
                self.agent_name = text("agent_name");
                self.workspace = text("workspace");
            }
            Some("installing_adapter") => self.phase = MacrodPhase::InstallingAdapter,
            Some("adapter_installed") => self.phase = MacrodPhase::Starting,
            Some("pairing") => {
                self.phase = MacrodPhase::Pairing;
                self.pairing_code = text("code");
                self.pairing_expires_at = text("expires_at");
            }
            Some("paired") => {
                self.pairing_code = None;
                self.pairing_expires_at = None;
                self.harness_id = text("harness_id");
            }
            Some("running") => {
                self.phase = MacrodPhase::Running;
                self.harness_id = text("harness_id");
            }
            Some("fatal") => {
                self.phase = MacrodPhase::Error;
                self.last_error = text("message");
            }
            _ => {}
        }
    }
}

/// The supervised daemon, managed as Tauri state.
#[derive(Default)]
pub(crate) struct MacrodState {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    /// The live child; `None` once it exited or was stopped.
    child: Option<tokio::process::Child>,
    status: MacrodStatus,
    /// Increments per start so a stale reader task cannot clobber a newer run.
    generation: u64,
}

fn emit_status(app: &AppHandle, status: &MacrodStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        tracing::warn!(?error, "failed to emit macrod status");
    }
}

/// The user's login-shell `PATH`, resolved once. `None` when it cannot be
/// read (non-unix, odd shells); callers fall back to the process `PATH`.
fn login_shell_path() -> Option<&'static str> {
    static RESOLVED: OnceLock<Option<String>> = OnceLock::new();
    RESOLVED
        .get_or_init(|| {
            #[cfg(unix)]
            {
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned());
                // `env` output is shell-agnostic (fish would join "$PATH" with
                // spaces); take the last PATH= line in case a login banner
                // happens to contain one.
                let output = std::process::Command::new(&shell)
                    .args(["-l", "-c", "env"])
                    .stdin(Stdio::null())
                    .output()
                    .ok()?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout
                    .lines()
                    .rev()
                    .find_map(|line| line.strip_prefix("PATH="))
                    .map(str::to_owned)
                    .filter(|path| !path.is_empty())
            }
            #[cfg(not(unix))]
            {
                None
            }
        })
        .as_deref()
}

/// The `PATH` macrod runs with: login shell first, then this process's own,
/// then well-known install locations, deduplicated in order.
fn macrod_path_env() -> String {
    let mut directories: Vec<String> = Vec::new();
    let mut push = |value: &str| {
        for directory in std::env::split_paths(value) {
            let directory = directory.to_string_lossy().into_owned();
            if !directory.is_empty() && !directories.contains(&directory) {
                directories.push(directory);
            }
        }
    };
    if let Some(path) = login_shell_path() {
        push(path);
    }
    if let Ok(path) = std::env::var("PATH") {
        push(&path);
    }
    if let Ok(home) = std::env::var("HOME") {
        for suffix in [".local/bin", ".bun/bin", ".volta/bin", ".cargo/bin"] {
            push(&format!("{home}/{suffix}"));
        }
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin"] {
        push(directory);
    }
    directories.join(if cfg!(windows) { ";" } else { ":" })
}

/// Locate the macrod binary: an explicit override, the bundled copy next to
/// this executable, the resource directory, then the development `PATH`.
fn macrod_binary(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "macrod.exe"
    } else {
        "macrod"
    };
    if let Ok(path) = std::env::var("MACROD_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join(name)))
        .filter(|path| path.is_file())
    {
        return Some(path);
    }
    if let Some(path) = app
        .path()
        .resource_dir()
        .ok()
        .map(|resources| resources.join(name))
        .filter(|path| path.is_file())
    {
        return Some(path);
    }
    std::env::split_paths(&macrod_path_env())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

fn macrod_command(app: &AppHandle) -> Result<tokio::process::Command, String> {
    let binary =
        macrod_binary(app).ok_or_else(|| "macrod is not bundled with this build".to_owned())?;
    let mut command = tokio::process::Command::new(binary);
    command.env("PATH", macrod_path_env());
    if crate::AppEnvironment::current() == crate::AppEnvironment::Development {
        // A config created by this daemon must target the dev deployment,
        // like the webview it pairs with.
        command.env("DEV_MODE", "1");
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command)
}

/// Run a one-shot macrod query and parse its stdout as JSON.
async fn macrod_query(app: &AppHandle, args: &[&str]) -> Result<serde_json::Value, String> {
    let output = macrod_command(app)?
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("could not run macrod: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "macrod {} failed: {}",
            args.join(" "),
            stderr.trim().lines().last().unwrap_or("no output")
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("macrod {} returned invalid JSON: {error}", args.join(" ")))
}

/// Whether this build can run a local agent runtime, and the daemon facts the
/// setup flow pre-fills from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MacrodSupport {
    /// Whether the bundled daemon exists on this platform and build.
    supported: bool,
    /// Suggested workspace directory for a first-time setup.
    default_workspace: Option<String>,
}

#[tauri::command]
pub(crate) fn macrod_support(app: AppHandle) -> MacrodSupport {
    let supported = macrod_binary(&app).is_some();
    let default_workspace = app
        .path()
        .home_dir()
        .ok()
        .map(|home| home.join("Macro").to_string_lossy().into_owned());
    MacrodSupport {
        supported,
        default_workspace,
    }
}

/// The ACP agents installed on this machine, from `macrod detect-agents`.
#[tauri::command]
pub(crate) async fn macrod_detect_agents(app: AppHandle) -> Result<serde_json::Value, String> {
    macrod_query(&app, &["detect-agents"]).await
}

/// The service config's state, from `macrod inspect`.
#[tauri::command]
pub(crate) async fn macrod_inspect(app: AppHandle) -> Result<serde_json::Value, String> {
    macrod_query(&app, &["inspect"]).await
}

/// Setup choices for a first-time (or re-) configuration. All optional: a
/// plain restart of an already configured daemon passes none of them.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MacrodStartOptions {
    agent: Option<String>,
    workspace: Option<String>,
    scope: Option<String>,
    allow_permission_bypass: Option<bool>,
}

/// Start (or restart) the supervised daemon and remember to auto-start it on
/// the next app launch.
#[tauri::command]
pub(crate) async fn macrod_start(
    app: AppHandle,
    state: tauri::State<'_, MacrodState>,
    options: MacrodStartOptions,
) -> Result<MacrodStatus, String> {
    stop_child(&app, &state.inner).await;

    let mut command = macrod_command(&app)?;
    command.arg("service");
    if let Some(agent) = &options.agent {
        command.args(["--agent", agent]);
    }
    if let Some(workspace) = &options.workspace {
        command.args(["--workspace", workspace]);
    }
    if let Some(scope) = &options.scope {
        command.args(["--scope", scope]);
    }
    if let Some(allowed) = options.allow_permission_bypass {
        command.args([
            "--allow-permission-bypass",
            if allowed { "true" } else { "false" },
        ]);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("could not start macrod: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "macrod started without stdout".to_owned())?;
    let stderr = child.stderr.take();

    let status = {
        let mut inner = state.inner.lock().expect("macrod state lock");
        inner.child = Some(child);
        inner.generation += 1;
        inner.status = MacrodStatus {
            phase: MacrodPhase::Starting,
            ..MacrodStatus::default()
        };
        tauri::async_runtime::spawn(read_events(
            app.clone(),
            state.inner.clone(),
            inner.generation,
            stdout,
        ));
        inner.status.clone()
    };
    if let Some(stderr) = stderr {
        tauri::async_runtime::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "macrod", "{line}");
            }
        });
    }
    set_autostart(&app, true);
    emit_status(&app, &status);
    Ok(status)
}

/// Fold the service's stdout into the snapshot until it closes.
async fn read_events(
    app: AppHandle,
    inner: Arc<Mutex<Inner>>,
    generation: u64,
    stdout: tokio::process::ChildStdout,
) {
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            tracing::warn!(target: "macrod", "unparseable service event: {line}");
            continue;
        };
        let status = {
            let mut inner = inner.lock().expect("macrod state lock");
            if inner.generation != generation {
                return;
            }
            inner.status.apply(&event);
            inner.status.clone()
        };
        emit_status(&app, &status);
    }
    // stdout closed: the daemon exited. Keep an error phase so the user sees
    // why; otherwise show it as stopped.
    let status = {
        let mut inner = inner.lock().expect("macrod state lock");
        if inner.generation != generation {
            return;
        }
        inner.child = None;
        if inner.status.phase != MacrodPhase::Error {
            inner.status.phase = MacrodPhase::Stopped;
        }
        inner.status.clone()
    };
    emit_status(&app, &status);
}

/// Stop the supervised daemon and stop auto-starting it.
#[tauri::command]
pub(crate) async fn macrod_stop(
    app: AppHandle,
    state: tauri::State<'_, MacrodState>,
) -> Result<MacrodStatus, String> {
    set_autostart(&app, false);
    stop_child(&app, &state.inner).await;
    let status = {
        let mut inner = state.inner.lock().expect("macrod state lock");
        inner.status = MacrodStatus::default();
        inner.status.clone()
    };
    emit_status(&app, &status);
    Ok(status)
}

/// The current snapshot, for a webview that (re)mounted after events fired.
#[tauri::command]
pub(crate) fn macrod_status(state: tauri::State<'_, MacrodState>) -> MacrodStatus {
    state
        .inner
        .lock()
        .expect("macrod state lock")
        .status
        .clone()
}

/// Kill the child synchronously; the app is exiting and cannot await.
pub(crate) fn kill_now(state: &MacrodState) {
    let child = {
        let mut inner = state.inner.lock().expect("macrod state lock");
        inner.generation += 1;
        inner.child.take()
    };
    if let Some(mut child) = child {
        let _ = child.start_kill();
    }
}

/// Kill the child, invalidating any reader still attached to it.
async fn stop_child(_app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let child = {
        let mut inner = inner.lock().expect("macrod state lock");
        inner.generation += 1;
        inner.child.take()
    };
    if let Some(mut child) = child {
        // Closing stdin asks the service to shut down on its own; the kill is
        // the backstop for a wedged process.
        child.stdin.take();
        match tokio::time::timeout(std::time::Duration::from_secs(3), child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
        }
    }
}

/// Where the auto-start marker lives: a tiny JSON file in the app's config
/// directory, read before the webview exists.
fn autostart_marker(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join("macrod.json"))
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AutostartMarker {
    autostart: bool,
}

fn set_autostart(app: &AppHandle, autostart: bool) {
    let Some(path) = autostart_marker(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let marker = AutostartMarker { autostart };
    if let Err(error) = std::fs::write(
        &path,
        serde_json::to_vec(&marker).expect("marker is plain data"),
    ) {
        tracing::warn!(?error, "failed to persist macrod autostart marker");
    }
}

fn autostart_enabled(app: &AppHandle) -> bool {
    autostart_marker(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|raw| serde_json::from_slice::<AutostartMarker>(&raw).ok())
        .is_some_and(|marker| marker.autostart)
}

/// At app launch: resume the daemon when the user enabled it and a paired
/// config exists, so agents are reachable without opening settings.
pub(crate) fn autostart(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !autostart_enabled(&app) || macrod_binary(&app).is_none() {
            return;
        }
        let paired = match macrod_query(&app, &["inspect"]).await {
            Ok(inspection) => inspection
                .get("paired")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            Err(error) => {
                tracing::warn!(target: "macrod", "autostart inspect failed: {error}");
                false
            }
        };
        if !paired {
            return;
        }
        let state = app.state::<MacrodState>();
        if let Err(error) = macrod_start(app.clone(), state, MacrodStartOptions::default()).await {
            tracing::warn!(target: "macrod", "autostart failed: {error}");
        }
    });
}
