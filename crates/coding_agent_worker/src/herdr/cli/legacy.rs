//! herdr 0.9 and earlier: the `herdr` multiplexer CLI, with workspaces, tabs,
//! panes, worktrees, and a built-in agent registry.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::{AgentInfo, AgentLaunch, HerdrError, Window, run};
use crate::herdr::wire::AgentState;

/// The agent source macrod reports under. herdr scopes reported state per
/// source, so this must not collide with a built-in integration's name.
const REPORT_SOURCE: &str = "macrod";
const REPORT_AGENT: &str = "macro";
const DISPLAY_AGENT: &str = "Macro agent";
/// How long a new tab's shell may take to reach its prompt.
const SHELL_READY_TIMEOUT: Duration = Duration::from_secs(10);
const SHELL_READY_POLL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone)]
pub(super) struct Legacy {
    pub(super) bin: PathBuf,
    pub(super) workspace_id: Option<String>,
}

impl Legacy {
    pub(super) async fn open_agent(&self, launch: &AgentLaunch<'_>) -> Result<Window, HerdrError> {
        let output = self
            .run(&[
                "workspace",
                "create",
                "--cwd",
                &launch.cwd.to_string_lossy(),
                "--label",
                launch.label,
                if launch.focus {
                    "--focus"
                } else {
                    "--no-focus"
                },
            ])
            .await?;
        let created: WorkspaceCreated =
            serde_json::from_str(&output).map_err(|source| HerdrError::Unparsable {
                command: "workspace create".to_owned(),
                source,
            })?;
        Ok(Window {
            workspace_id: Some(created.result.workspace.workspace_id),
            tab_id: created.result.root_pane.tab_id,
            pane_id: created.result.root_pane.pane_id,
        })
    }

    pub(super) async fn start_in_window(
        &self,
        launch: &AgentLaunch<'_>,
        window: &Window,
    ) -> Result<(), HerdrError> {
        if let Some(environment) = launch.environment {
            self.run(&[
                "pane",
                "run",
                &window.pane_id,
                &format!(". {}", shell_words::quote(&environment.to_string_lossy())),
            ])
            .await?;
        }
        // The tab's shell must reach its prompt before an agent can start,
        // and a worktree's direnv can hold it for seconds.
        let deadline = tokio::time::Instant::now() + SHELL_READY_TIMEOUT;
        loop {
            match self.start_agent(launch, &window.pane_id).await {
                Err(error) if error.pane_busy() && tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(SHELL_READY_POLL).await;
                }
                result => break result?,
            }
        }
        Ok(())
    }

    pub(super) async fn open_viewer(
        &self,
        cwd: &Path,
        command: &[String],
    ) -> Result<Window, HerdrError> {
        let window = self.open_window(cwd, "macro", false).await?;
        self.run(&["pane", "run", &window.pane_id, &shell_words::join(command)])
            .await?;
        self.report_title(&window.pane_id, None).await?;
        Ok(window)
    }

    pub(super) async fn name_viewer(&self, window: &Window, title: &str) -> Result<(), HerdrError> {
        self.run(&["tab", "rename", &window.tab_id, title]).await?;
        self.report_title(&window.pane_id, Some(title)).await
    }

    /// Report the lifecycle state of the agent a pane hosts, which is what
    /// herdr's sidebar and notifications are driven by.
    pub(super) async fn report_state(
        &self,
        window: &Window,
        state: AgentState,
        message: Option<&str>,
        seq: u64,
    ) -> Result<(), HerdrError> {
        let seq = seq.to_string();
        let mut args = vec![
            "pane",
            "report-agent",
            &window.pane_id,
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

    pub(super) async fn prompt_agent(&self, name: &str, text: &str) -> Result<(), HerdrError> {
        self.run(&["agent", "prompt", name, text]).await.map(drop)
    }

    pub(super) async fn agent_info(&self, name: &str) -> Result<AgentInfo, HerdrError> {
        let output = self.run(&["agent", "get", name]).await?;
        let answer: Value =
            serde_json::from_str(output.trim()).map_err(|source| HerdrError::Unparsable {
                command: "agent get".to_owned(),
                source,
            })?;
        Ok(AgentInfo {
            window: answer.pointer("/result/agent").and_then(|agent| {
                Some(Window {
                    workspace_id: None,
                    pane_id: agent.get("pane_id")?.as_str()?.to_owned(),
                    tab_id: agent.get("tab_id")?.as_str()?.to_owned(),
                })
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

    pub(super) async fn read_agent(&self, name: &str) -> Result<String, HerdrError> {
        self.run(&["agent", "read", name, "--source", "visible"])
            .await
    }

    pub(super) async fn send_keys(&self, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        let mut args = vec!["agent", "send-keys", name];
        args.extend(keys);
        self.run(&args).await.map(drop)
    }

    /// Only an explicitly closed pane permits creating a replacement workspace.
    pub(super) async fn existing_window(
        &self,
        window: &Window,
        cwd: &Path,
    ) -> Result<Option<Window>, HerdrError> {
        let output = match self.run(&["pane", "get", &window.pane_id]).await {
            Err(error) if error.has_code("/error/code", "pane_not_found") => return Ok(None),
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
        let current = Window {
            workspace_id: window
                .workspace_id
                .as_ref()
                .filter(|id| **id == pane.workspace_id)
                .cloned(),
            tab_id: pane.tab_id,
            pane_id: pane.pane_id,
        };
        self.available_shell(&current).await?;
        Ok(Some(current))
    }

    async fn available_shell(&self, window: &Window) -> Result<(), HerdrError> {
        let output = self
            .run(&["pane", "process-info", "--pane", &window.pane_id])
            .await?;
        let answer: ProcessAnswer =
            serde_json::from_str(&output).map_err(|source| HerdrError::Unparsable {
                command: "pane process-info".to_owned(),
                source,
            })?;
        let info = answer.result.process_info;
        if info.foreground_process_group_id != Some(info.shell_pid)
            || info
                .foreground_processes
                .iter()
                .any(|process| process.pid != info.shell_pid)
        {
            return Err(HerdrError::NotReady);
        }
        Ok(())
    }

    pub(super) async fn close_window(&self, window: &Window) -> Result<(), HerdrError> {
        if let Some(workspace) = &window.workspace_id {
            self.run(&["workspace", "close", workspace]).await?;
        }
        Ok(())
    }

    /// Open a tab in macrod's workspace, switching herdr to it when `focus`.
    async fn open_window(
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

    /// Start a recognized agent CLI in an idle shell pane under a unique
    /// name, returning once herdr sees it ready for input.
    async fn start_agent(&self, launch: &AgentLaunch<'_>, pane_id: &str) -> Result<(), HerdrError> {
        let mut args: Vec<&str> = vec![
            "agent",
            "start",
            launch.name,
            "--kind",
            launch.kind,
            "--pane",
            pane_id,
            "--timeout",
            "60000",
            "--",
        ];
        args.extend(launch.args.iter().map(String::as_str));
        self.run(&args).await.map(drop)
    }

    /// Name the agent and its task in herdr's sidebar.
    async fn report_title(&self, pane_id: &str, title: Option<&str>) -> Result<(), HerdrError> {
        let mut args = vec![
            "pane",
            "report-metadata",
            pane_id,
            "--source",
            REPORT_SOURCE,
            "--agent",
            REPORT_AGENT,
            "--display-agent",
            DISPLAY_AGENT,
        ];
        if let Some(title) = title {
            args.extend(["--title", title]);
        }
        self.run(&args).await.map(drop)
    }

    async fn run<Arg: AsRef<str>>(&self, args: &[Arg]) -> Result<String, HerdrError> {
        run(&self.bin, args).await
    }
}

#[derive(Deserialize)]
struct WorkspaceCreated {
    result: WorkspaceCreatedResult,
}

#[derive(Deserialize)]
struct WorkspaceCreatedResult {
    workspace: WorkspaceId,
    root_pane: CreatedPane,
}

#[derive(Deserialize)]
struct WorkspaceId {
    workspace_id: String,
}

#[derive(Deserialize)]
struct PaneAnswer {
    result: PaneResult,
}

#[derive(Deserialize)]
struct PaneResult {
    pane: Pane,
}

#[derive(Deserialize)]
struct Pane {
    workspace_id: String,
    tab_id: String,
    pane_id: String,
    cwd: PathBuf,
    foreground_cwd: Option<PathBuf>,
}

#[derive(Deserialize)]
struct ProcessAnswer {
    result: ProcessResult,
}

#[derive(Deserialize)]
struct ProcessResult {
    process_info: ProcessInfo,
}

#[derive(Deserialize)]
struct ProcessInfo {
    shell_pid: u32,
    foreground_process_group_id: Option<u32>,
    foreground_processes: Vec<Process>,
}

#[derive(Deserialize)]
struct Process {
    pid: u32,
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
struct CreatedPane {
    pane_id: String,
    tab_id: String,
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
