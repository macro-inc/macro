//! herdr-core (`hc`) and the herdr app: the core runs every terminal and
//! knows nothing about windows; the app shows a core terminal as a tab once
//! it carries the app's `herdr.space` and `herdr.tab` labels.
//!
//! A program's status is whatever it reports through OSC 7501. Claude Code
//! reports it; a TUI that does not (Codex today) has none, so macrod cannot
//! see it working or blocked.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::OnceCell;

use super::{AgentInfo, AgentLaunch, HerdrError, Window, run};

/// The labels the herdr app adopts terminals by.
const SPACE_LABEL: &str = "herdr.space";
const TAB_LABEL: &str = "herdr.tab";
/// The agent a session terminal was started for, to tell it from the shell
/// core leaves behind when a kept terminal loses its program.
const AGENT_LABEL: &str = "macro.agent";
/// The herdr app's CLI; optional, so every call to it is best effort.
const APP_BIN: &str = "herdr-app";
/// How long a new agent may take to report it is ready for input.
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(60);
const AGENT_READY_POLL: Duration = Duration::from_millis(250);
/// Polls with an unchanged screen after which an agent that never reports
/// status counts as ready.
const SETTLED_POLLS: u32 = 8;

#[derive(Debug, Clone)]
pub(super) struct Core {
    pub(super) bin: PathBuf,
    /// macrod's own terminal, whose space new tabs open in.
    pub(super) terminal: String,
    pub(super) space: Arc<OnceCell<Option<String>>>,
}

/// The parts of a core `Terminal` record macrod reads.
#[derive(Debug, Deserialize)]
pub(super) struct Terminal {
    address: String,
    state: String,
    cwd: String,
    #[serde(default)]
    labels: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    status: Option<Status>,
    #[serde(default)]
    status_ms: Option<u64>,
    #[serde(default)]
    foreground: Option<Foreground>,
}

#[derive(Debug, Deserialize)]
struct Status {
    state: String,
}

#[derive(Debug, Deserialize)]
struct Foreground {
    name: String,
}

impl Terminal {
    fn label(&self, key: &str) -> Option<&str> {
        self.labels.as_ref()?.get(key).map(String::as_str)
    }

    /// Whether the agent it was started for still runs in it. A finished
    /// terminal has no agent; neither does a kept one whose agent was lost
    /// and replaced by a shell. A reported status belongs to a live agent,
    /// since core clears it when the program ends.
    fn agent_running(&self) -> bool {
        if self.state != "live" {
            return false;
        }
        if self.status.is_some() {
            return true;
        }
        match (self.label(AGENT_LABEL), &self.foreground) {
            (Some(agent), Some(foreground)) => foreground.name.contains(agent),
            _ => true,
        }
    }

    pub(super) fn info(self) -> Result<AgentInfo, HerdrError> {
        if !self.agent_running() {
            return Err(HerdrError::Ended);
        }
        Ok(AgentInfo {
            status: self
                .status
                .map(|status| status.state)
                .unwrap_or_else(|| "unknown".to_owned()),
            session_id: None,
            cwd: Some(PathBuf::from(self.cwd)),
            state_change_seq: self.status_ms.unwrap_or_default(),
        })
    }
}

impl Core {
    /// Add a worktree of `source` at `path` on a new branch from the
    /// freshly fetched main. Core has no worktree concept; git does it.
    pub(super) async fn create_worktree(
        &self,
        source: &Path,
        path: &Path,
        branch: &str,
    ) -> rootcause::Result<()> {
        crate::outbound::git::git(
            source,
            &[
                "worktree",
                "add",
                "-b",
                branch,
                &path.to_string_lossy(),
                "origin/main",
            ],
        )
        .await
        .map(drop)
    }

    /// Start a shell in a new tab, then replace it with the agent, so the
    /// agent gets the operator's login environment (PATH, direnv) as it
    /// would in a terminal they opened themselves.
    pub(super) async fn launch_agent(
        &self,
        launch: &AgentLaunch<'_>,
    ) -> Result<Window, HerdrError> {
        self.clear(launch.name).await;
        // A worktree opens as its own space, as herdr's worktree workspaces did.
        let space = match launch.worktree_source {
            Some(_) => new_id(),
            None => self.space().await,
        };
        let tab = new_id();
        let terminal = self
            .start(
                Some(launch.name),
                launch.cwd,
                &space,
                &tab,
                &[format!("{AGENT_LABEL}={}", launch.kind)],
                &[],
            )
            .await?;
        let mut line = String::new();
        if let Some(environment) = launch.environment {
            line.push_str(&format!(
                ". {} && ",
                shell_words::quote(&environment.to_string_lossy())
            ));
        }
        let mut command = vec![launch.kind.to_owned()];
        command.extend(launch.args.iter().cloned());
        line.push_str("exec ");
        line.push_str(&shell_words::join(&command));
        self.run(&["send", &terminal.address, &line]).await?;
        self.wait_ready(launch).await?;
        tracing::debug!(terminal = %terminal.address, agent = launch.kind, "agent ready in herdr-core");
        self.app("tab.rename", json!({"id": tab, "name": launch.label}))
            .await;
        if launch.focus {
            self.app("agent.focus", json!({"terminal": terminal.address}))
                .await;
        }
        Ok(Window {
            tab_id: tab,
            pane_id: terminal.address,
        })
    }

    pub(super) async fn open_viewer(
        &self,
        cwd: &Path,
        command: &[String],
    ) -> Result<Window, HerdrError> {
        let space = self.space().await;
        let tab = new_id();
        let terminal = self.start(None, cwd, &space, &tab, &[], command).await?;
        Ok(Window {
            tab_id: tab,
            pane_id: terminal.address,
        })
    }

    pub(super) async fn name_viewer(&self, window: &Window, title: &str) {
        self.app("tab.rename", json!({"id": window.tab_id, "name": title}))
            .await;
    }

    pub(super) async fn prompt_agent(&self, name: &str, text: &str) -> Result<(), HerdrError> {
        self.run(&["send", name, text]).await.map(drop)
    }

    pub(super) async fn agent_info(&self, name: &str) -> Result<AgentInfo, HerdrError> {
        self.get(name).await?.info()
    }

    pub(super) async fn read_agent(&self, name: &str) -> Result<String, HerdrError> {
        self.run(&["read", name]).await
    }

    pub(super) async fn send_keys(&self, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        let mut args = vec!["keys", name];
        args.extend(keys);
        self.run(&args).await.map(drop)
    }

    /// Run a terminal in `space`'s tab `tab`, outliving macrod like a tab
    /// someone opened by hand. With no `command`, it runs the user's shell.
    async fn start(
        &self,
        name: Option<&str>,
        cwd: &Path,
        space: &str,
        tab: &str,
        labels: &[String],
        command: &[String],
    ) -> Result<Terminal, HerdrError> {
        let mut args = vec![
            "run".to_owned(),
            "--bg".to_owned(),
            "--json".to_owned(),
            "--no-parent".to_owned(),
            "--cwd".to_owned(),
            cwd.to_string_lossy().into_owned(),
            "--label".to_owned(),
            format!("{SPACE_LABEL}={space}"),
            "--label".to_owned(),
            format!("{TAB_LABEL}={tab}"),
        ];
        for label in labels {
            args.extend(["--label".to_owned(), label.clone()]);
        }
        if let Some(name) = name {
            args.extend(["--name".to_owned(), name.to_owned()]);
        }
        if !command.is_empty() {
            args.push("--".to_owned());
            args.extend(command.iter().cloned());
        }
        let output = self.run(&args).await?;
        parse_terminal("run", &output)
    }

    /// Wait for the agent to report it is idle. One that never reports
    /// status is ready once its screen stops changing; one that does must
    /// say so, or it is likely on a dialog (folder trust, sign-in) where a
    /// typed prompt would answer the wrong question.
    async fn wait_ready(&self, launch: &AgentLaunch<'_>) -> Result<(), HerdrError> {
        let deadline = tokio::time::Instant::now() + AGENT_READY_TIMEOUT;
        let mut screen = String::new();
        let mut settled = 0u32;
        while tokio::time::Instant::now() < deadline {
            tokio::time::sleep(AGENT_READY_POLL).await;
            let terminal = self.get(launch.name).await?;
            if terminal.state != "live" {
                return Err(HerdrError::Ended);
            }
            if let Some(status) = &terminal.status {
                if status.state != "working" {
                    return Ok(());
                }
                continue;
            }
            if launch.reports_status
                || !terminal
                    .foreground
                    .as_ref()
                    .is_some_and(|foreground| foreground.name.contains(launch.kind))
            {
                continue;
            }
            let current = self.read_agent(launch.name).await?;
            settled = if current == screen { settled + 1 } else { 0 };
            screen = current;
            if settled >= SETTLED_POLLS {
                return Ok(());
            }
        }
        if launch.reports_status {
            return Err(HerdrError::NotReady);
        }
        Ok(())
    }

    /// Remove a previous terminal of this name: a finished one keeps its
    /// name until removed, and a kept one may be a shell left behind by a
    /// lost agent.
    async fn clear(&self, name: &str) {
        let Ok(terminal) = self.get(name).await else {
            return;
        };
        if terminal.state == "live"
            && let Err(error) = self.run(&["kill", name]).await
        {
            tracing::warn!(%error, terminal = name, "could not end a stale session terminal");
        }
        if let Err(error) = self.run(&["rm", name]).await {
            tracing::debug!(%error, terminal = name, "could not remove a stale session terminal");
        }
    }

    async fn get(&self, terminal: &str) -> Result<Terminal, HerdrError> {
        let output = self.run(&["get", terminal, "--json"]).await?;
        parse_terminal("get", &output)
    }

    /// The herdr app space macrod's terminal is in; a new one when macrod
    /// runs outside the app.
    async fn space(&self) -> String {
        let space = self
            .space
            .get_or_init(|| async {
                match self.get(&self.terminal).await {
                    Ok(terminal) => terminal.label(SPACE_LABEL).map(str::to_owned),
                    Err(error) => {
                        tracing::warn!(%error, "could not read macrod's herdr-core terminal");
                        None
                    }
                }
            })
            .await;
        space.clone().unwrap_or_else(new_id)
    }

    /// Run an action in the open herdr app window, if there is one. Tabs
    /// work without the app, so failure is only logged.
    async fn app(&self, action: &str, arguments: Value) {
        if let Err(error) = run(Path::new(APP_BIN), &["do", action, &arguments.to_string()]).await {
            tracing::debug!(%error, action, "herdr app action failed");
        }
    }

    async fn run<Arg: AsRef<str>>(&self, args: &[Arg]) -> Result<String, HerdrError> {
        run(&self.bin, args).await
    }
}

fn new_id() -> String {
    uuid::Uuid::now_v7().simple().to_string()
}

pub(super) fn parse_terminal(command: &str, output: &str) -> Result<Terminal, HerdrError> {
    serde_json::from_str(output.trim()).map_err(|source| HerdrError::Unparsable {
        command: command.to_owned(),
        source,
    })
}
