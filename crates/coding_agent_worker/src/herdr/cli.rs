//! The `herdr` CLI, as the one outbound door into the herdr session that
//! launched this daemon. Every command talks to that session's socket
//! through the environment herdr injected into macrod's pane.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::wire::AgentState;

/// The agent source macrod reports under. herdr scopes reported state per
/// source, so this must not collide with a built-in integration's name.
const REPORT_SOURCE: &str = "macrod";
const REPORT_AGENT: &str = "macro";

/// A failure running a herdr command.
#[derive(Debug, thiserror::Error)]
pub(crate) enum HerdrError {
    /// The Herdr command did not finish within its deadline.
    #[error("herdr command timed out")]
    Timeout,
    /// The binary could not be started.
    #[error("could not run herdr")]
    Spawn(#[source] std::io::Error),
    /// herdr ran and refused.
    #[error("herdr {command} failed: {stderr}")]
    Refused {
        /// The subcommand that failed.
        command: String,
        /// What herdr printed to stderr.
        stderr: String,
    },
    /// herdr answered with JSON this daemon does not understand.
    #[error("herdr {command} answered unexpectedly")]
    Unparsable {
        /// The subcommand that answered.
        command: String,
        /// The parse failure.
        #[source]
        source: serde_json::Error,
    },
}

impl HerdrError {
    /// Only an explicit missing-agent response permits a native session restart.
    pub(crate) fn missing_agent(&self) -> bool {
        self.has_code("agent_not_found")
    }

    /// The pane is not yet at its shell prompt, e.g. while direnv loads.
    pub(crate) fn pane_busy(&self) -> bool {
        self.has_code("agent_pane_busy")
    }

    fn has_code(&self, code: &str) -> bool {
        let Self::Refused { stderr, .. } = self else {
            return false;
        };
        serde_json::from_str::<Value>(stderr)
            .ok()
            .is_some_and(|value| value.pointer("/error/code").and_then(Value::as_str) == Some(code))
    }
}

/// The tab and root pane a new herdr window opened with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Window {
    /// A workspace macrod created for this session, absent for older shared tabs.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// The tab, e.g. `w1:t2`.
    pub tab_id: String,
    /// The tab's only pane, e.g. `w1:p2`.
    pub pane_id: String,
}

/// What herdr knows about a running agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentInfo {
    /// `idle`, `working`, `blocked`, `done`, or `unknown`.
    pub status: String,
    /// The agent's own session id, when its integration reports one.
    pub session_id: Option<String>,
    /// Native pane working directory, for reconnect validation.
    pub cwd: Option<PathBuf>,
    /// Monotonic native state generation, used to reject stale permissions.
    pub state_change_seq: u64,
    /// Current tab and pane, including sessions started before tab persistence.
    pub window: Option<Window>,
    /// The agent's current workspace; this does not imply macrod owns it.
    pub workspace_id: Option<String>,
}

/// Drives the herdr session through its CLI.
#[derive(Debug, Clone)]
pub(crate) struct HerdrCli {
    bin: PathBuf,
    workspace_id: Option<String>,
}

impl HerdrCli {
    /// Drive the session the given binary is attached to, opening windows in
    /// `workspace_id` (herdr's focused workspace when absent).
    pub(crate) fn new(bin: impl Into<PathBuf>, workspace_id: Option<String>) -> Self {
        Self {
            bin: bin.into(),
            workspace_id,
        }
    }

    /// Open a tab in macrod's workspace, switching herdr to it when `focus`.
    pub(crate) async fn open_window(
        &self,
        cwd: &Path,
        label: &str,
        focus: bool,
    ) -> Result<Window, HerdrError> {
        let mut args = vec!["tab".to_owned(), "create".to_owned()];
        if let Some(workspace) = &self.workspace_id {
            args.extend(["--workspace".to_owned(), workspace.clone()]);
        }
        args.extend([
            "--cwd".to_owned(),
            cwd.to_string_lossy().into_owned(),
            "--label".to_owned(),
            label.to_owned(),
            if focus { "--focus" } else { "--no-focus" }.to_owned(),
        ]);
        let output = self.run(&args).await?;
        parse_window(&output)
    }

    /// Open an independent workspace without registering it as a linked worktree.
    #[tracing::instrument(
        name = "macrod.open_session_workspace",
        skip_all,
        fields(workspace_id),
        err
    )]
    pub(crate) async fn open_workspace(
        &self,
        cwd: &Path,
        label: &str,
        focus: bool,
    ) -> Result<Window, HerdrError> {
        let output = self
            .run(&[
                "workspace",
                "create",
                "--cwd",
                &cwd.to_string_lossy(),
                "--label",
                label,
                if focus { "--focus" } else { "--no-focus" },
            ])
            .await?;
        let created: WorkspaceCreated =
            serde_json::from_str(&output).map_err(|source| HerdrError::Unparsable {
                command: "workspace create".to_owned(),
                source,
            })?;
        let workspace_id = created.result.workspace.workspace_id;
        tracing::Span::current().record("workspace_id", workspace_id.as_str());
        Ok(Window {
            workspace_id: Some(workspace_id),
            tab_id: created.result.root_pane.tab_id,
            pane_id: created.result.root_pane.pane_id,
        })
    }

    /// Resolve a session's current tab without sending input to its pane.
    pub(crate) async fn current_window(
        &self,
        window: &Window,
        cwd: &Path,
    ) -> Result<Option<Window>, HerdrError> {
        let output = match self.run(&["pane", "get", &window.pane_id]).await {
            Err(error) if error.has_code("pane_not_found") => return Ok(None),
            result => result?,
        };
        let answer: PaneAnswer =
            serde_json::from_str(&output).map_err(|source| HerdrError::Unparsable {
                command: "pane get".to_owned(),
                source,
            })?;
        let pane = answer.result.pane;
        if pane.foreground_cwd.as_ref().unwrap_or(&pane.cwd) != cwd {
            return Err(HerdrError::Refused {
                command: "pane get".to_owned(),
                stderr: "the session's pane is now in a different directory".to_owned(),
            });
        }
        Ok(Some(Window {
            workspace_id: window
                .workspace_id
                .as_ref()
                .filter(|workspace| **workspace == pane.workspace_id)
                .cloned(),
            pane_id: pane.pane_id,
            tab_id: pane.tab_id,
        }))
    }

    /// Reuse a session's tab only while its shell owns the foreground.
    pub(crate) async fn existing_window(
        &self,
        window: &Window,
        cwd: &Path,
    ) -> Result<Option<Window>, HerdrError> {
        let Some(window) = self.current_window(window, cwd).await? else {
            return Ok(None);
        };
        let output = self
            .run(&["pane", "process-info", "--pane", &window.pane_id])
            .await?;
        let process: ProcessAnswer =
            serde_json::from_str(&output).map_err(|source| HerdrError::Unparsable {
                command: "pane process-info".to_owned(),
                source,
            })?;
        let process = process.result.process_info;
        if process.shell_pid == 0 || process.foreground_process_group_id != process.shell_pid {
            return Err(HerdrError::Refused {
                command: "pane process-info".to_owned(),
                stderr: "the session's pane is occupied; return it to its shell before retrying"
                    .to_owned(),
            });
        }
        Ok(Some(window))
    }

    /// Type a command into a pane's shell and press Enter.
    pub(crate) async fn run_in_pane(&self, pane_id: &str, command: &str) -> Result<(), HerdrError> {
        self.run(&["pane", "run", pane_id, command]).await.map(drop)
    }

    /// Relabel a tab.
    pub(crate) async fn rename_tab(&self, tab_id: &str, label: &str) -> Result<(), HerdrError> {
        self.run(&["tab", "rename", tab_id, label]).await.map(drop)
    }

    /// Relabel the session's tab and its dedicated workspace, if it owns one.
    pub(crate) async fn rename_window(
        &self,
        window: &Window,
        label: &str,
    ) -> Result<(), HerdrError> {
        self.rename_tab(&window.tab_id, label).await?;
        if let Some(workspace) = &window.workspace_id {
            self.run(&["workspace", "rename", workspace, label]).await?;
        }
        Ok(())
    }

    /// Roll back newly opened layout when its session metadata could not be saved.
    pub(crate) async fn close_window(&self, window: &Window) -> Result<(), HerdrError> {
        match &window.workspace_id {
            Some(workspace) => self.run(&["workspace", "close", workspace]).await.map(drop),
            None => self.run(&["tab", "close", &window.tab_id]).await.map(drop),
        }
    }

    /// Report the lifecycle state of the agent a pane hosts, which is what
    /// herdr's sidebar and notifications are driven by.
    pub(crate) async fn report_state(
        &self,
        pane_id: &str,
        state: AgentState,
        message: Option<&str>,
        seq: u64,
    ) -> Result<(), HerdrError> {
        let seq = seq.to_string();
        let mut args = vec![
            "pane",
            "report-agent",
            pane_id,
            "--source",
            REPORT_SOURCE,
            "--agent",
            REPORT_AGENT,
            "--state",
            state.as_herdr(),
            "--seq",
            &seq,
        ];
        if let Some(message) = message {
            args.extend(["--message", message]);
        }
        self.run(&args).await.map(drop)
    }

    /// Name the agent and its task in herdr's sidebar.
    pub(crate) async fn report_title(
        &self,
        pane_id: &str,
        display_agent: &str,
        title: Option<&str>,
    ) -> Result<(), HerdrError> {
        let mut args = vec![
            "pane",
            "report-metadata",
            pane_id,
            "--source",
            REPORT_SOURCE,
            "--agent",
            REPORT_AGENT,
            "--display-agent",
            display_agent,
        ];
        if let Some(title) = title {
            args.extend(["--title", title]);
        }
        self.run(&args).await.map(drop)
    }

    /// Start a recognized agent CLI in an idle shell pane under a unique
    /// name, returning once herdr sees it ready for input.
    pub(crate) async fn start_agent(
        &self,
        name: &str,
        kind: &str,
        pane_id: &str,
        agent_args: &[String],
    ) -> Result<(), HerdrError> {
        let mut args: Vec<&str> = vec![
            "agent",
            "start",
            name,
            "--kind",
            kind,
            "--pane",
            pane_id,
            "--timeout",
            "60000",
            "--",
        ];
        args.extend(agent_args.iter().map(String::as_str));
        self.run(&args).await.map(drop)
    }

    /// Submit a prompt to a named agent's TUI, returning once it is typed.
    pub(crate) async fn prompt_agent(&self, name: &str, text: &str) -> Result<(), HerdrError> {
        self.run(&["agent", "prompt", name, text]).await.map(drop)
    }

    /// A named agent's lifecycle state and the agent's own session id.
    pub(crate) async fn agent_info(&self, name: &str) -> Result<AgentInfo, HerdrError> {
        let output = self.run(&["agent", "get", name]).await?;
        let answer: Value =
            serde_json::from_str(output.trim()).map_err(|source| HerdrError::Unparsable {
                command: "agent get".to_owned(),
                source,
            })?;
        Ok(AgentInfo {
            window: answer
                .pointer("/result/agent/pane_id")
                .and_then(Value::as_str)
                .zip(
                    answer
                        .pointer("/result/agent/tab_id")
                        .and_then(Value::as_str),
                )
                .map(|(pane_id, tab_id)| Window {
                    workspace_id: None,
                    pane_id: pane_id.to_owned(),
                    tab_id: tab_id.to_owned(),
                }),
            workspace_id: answer
                .pointer("/result/agent/workspace_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            cwd: answer
                .pointer("/result/agent/cwd")
                .and_then(Value::as_str)
                .map(PathBuf::from),
            state_change_seq: answer
                .pointer("/result/agent/state_change_seq")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            status: answer
                .pointer("/result/agent/agent_status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_owned(),
            session_id: answer
                .pointer("/result/agent/agent_session/value")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }

    /// The text a named agent's pane currently shows.
    pub(crate) async fn read_agent(&self, name: &str) -> Result<String, HerdrError> {
        self.run(&["agent", "read", name, "--source", "visible"])
            .await
    }

    /// Press logical keys (`enter`, `esc`, `ctrl+c`) in a named agent's TUI.
    pub(crate) async fn send_keys(&self, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        let mut args = vec!["agent", "send-keys", name];
        args.extend(keys);
        self.run(&args).await.map(drop)
    }

    async fn run<Arg: AsRef<str>>(&self, args: &[Arg]) -> Result<String, HerdrError> {
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(150),
            tokio::process::Command::new(&self.bin)
                .args(args.iter().map(AsRef::as_ref))
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| HerdrError::Timeout)?
        .map_err(HerdrError::Spawn)?;
        if !output.status.success() {
            return Err(HerdrError::Refused {
                command: describe(args),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

fn describe<Arg: AsRef<str>>(args: &[Arg]) -> String {
    args.iter()
        .take(2)
        .map(AsRef::as_ref)
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Deserialize)]
struct TabCreated {
    result: TabCreatedResult,
}

#[derive(Deserialize)]
struct TabCreatedResult {
    root_pane: CreatedPane,
}

#[derive(Deserialize)]
struct WorkspaceCreated {
    result: WorkspaceCreatedResult,
}

#[derive(Deserialize)]
struct WorkspaceCreatedResult {
    workspace: CreatedWorkspace,
    root_pane: CreatedPane,
}

#[derive(Deserialize)]
struct CreatedWorkspace {
    workspace_id: String,
}

#[derive(Deserialize)]
struct CreatedPane {
    pane_id: String,
    tab_id: String,
}

#[derive(Deserialize)]
struct PaneAnswer {
    result: PaneResult,
}

#[derive(Deserialize)]
struct PaneResult {
    pane: ExistingPane,
}

#[derive(Deserialize)]
struct ExistingPane {
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    cwd: PathBuf,
    foreground_cwd: Option<PathBuf>,
}

#[derive(Deserialize)]
struct ProcessAnswer {
    result: ProcessResult,
}

#[derive(Deserialize)]
struct ProcessResult {
    process_info: ShellProcess,
}

#[derive(Deserialize)]
struct ShellProcess {
    shell_pid: u32,
    foreground_process_group_id: u32,
}

/// Read the new window out of `tab create`'s JSON answer.
pub(crate) fn parse_window(output: &str) -> Result<Window, HerdrError> {
    let created: TabCreated =
        serde_json::from_str(output.trim()).map_err(|source| HerdrError::Unparsable {
            command: "tab create".to_owned(),
            source,
        })?;
    Ok(Window {
        workspace_id: None,
        tab_id: created.result.root_pane.tab_id,
        pane_id: created.result.root_pane.pane_id,
    })
}
