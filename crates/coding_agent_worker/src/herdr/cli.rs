//! The `herdr` CLI, as the one outbound door into the herdr session that
//! launched this daemon. Every command talks to that session's socket
//! through the environment herdr injected into macrod's pane.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use super::wire::AgentState;

/// The agent source macrod reports under. herdr scopes reported state per
/// source, so this must not collide with a built-in integration's name.
const REPORT_SOURCE: &str = "macrod";
const REPORT_AGENT: &str = "macro";

/// A failure running a herdr command.
#[derive(Debug, thiserror::Error)]
pub(crate) enum HerdrError {
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

/// The tab and root pane a new herdr window opened with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Window {
    /// The tab, e.g. `w1:t2`.
    pub tab_id: String,
    /// The tab's only pane, e.g. `w1:p2`.
    pub pane_id: String,
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

    /// Type a command into a pane's shell and press Enter.
    pub(crate) async fn run_in_pane(&self, pane_id: &str, command: &str) -> Result<(), HerdrError> {
        self.run(&["pane", "run", pane_id, command]).await.map(drop)
    }

    /// Relabel a tab.
    pub(crate) async fn rename_tab(&self, tab_id: &str, label: &str) -> Result<(), HerdrError> {
        self.run(&["tab", "rename", tab_id, label]).await.map(drop)
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
        self.run(&["agent", "prompt", name, text])
            .await
            .map(drop)
    }

    /// The agent's lifecycle state: `idle`, `working`, `blocked`, `done`,
    /// or `unknown`.
    pub(crate) async fn agent_status(&self, name: &str) -> Result<String, HerdrError> {
        let output = self.run(&["agent", "get", name]).await?;
        let answer: Value =
            serde_json::from_str(output.trim()).map_err(|source| HerdrError::Unparsable {
                command: "agent get".to_owned(),
                source,
            })?;
        Ok(answer
            .pointer("/result/agent/agent_status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned())
    }

    /// Press logical keys (`enter`, `esc`, `ctrl+c`) in a named agent's TUI.
    pub(crate) async fn send_keys(&self, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        let mut args = vec!["agent", "send-keys", name];
        args.extend(keys);
        self.run(&args).await.map(drop)
    }

    async fn run<Arg: AsRef<str>>(&self, args: &[Arg]) -> Result<String, HerdrError> {
        let output = tokio::process::Command::new(&self.bin)
            .args(args.iter().map(AsRef::as_ref))
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
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
