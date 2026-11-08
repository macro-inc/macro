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
    /// Let Herdr create and register a fresh worktree from the fetched main ref.
    pub(super) async fn create_worktree(
        &self,
        source: &Path,
        path: &Path,
        branch: &str,
    ) -> Result<(), HerdrError> {
        self.run(&[
            "worktree",
            "create",
            "--cwd",
            &source.to_string_lossy(),
            "--path",
            &path.to_string_lossy(),
            "--branch",
            branch,
            "--base",
            "origin/main",
            "--no-focus",
        ])
        .await
        .map(drop)
    }

    pub(super) async fn launch_agent(
        &self,
        launch: &AgentLaunch<'_>,
    ) -> Result<Window, HerdrError> {
        let window = match launch.worktree_source {
            Some(source) => {
                self.open_worktree(source, launch.cwd, launch.label, launch.focus)
                    .await?
            }
            None => {
                self.open_window(launch.cwd, launch.label, launch.focus)
                    .await?
            }
        };
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
        Ok(window)
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

    /// Reuse Herdr's workspace and its shell pane for a managed session worktree.
    async fn open_worktree(
        &self,
        source: &Path,
        path: &Path,
        label: &str,
        focus: bool,
    ) -> Result<Window, HerdrError> {
        let path = path.to_string_lossy();
        let output = self
            .run(&[
                "worktree",
                "open",
                "--cwd",
                &source.to_string_lossy(),
                "--path",
                &path,
                "--label",
                label,
                if focus { "--focus" } else { "--no-focus" },
            ])
            .await?;
        parse_window(&output)
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
        tab_id: created.result.root_pane.tab_id,
        pane_id: created.result.root_pane.pane_id,
    })
}
