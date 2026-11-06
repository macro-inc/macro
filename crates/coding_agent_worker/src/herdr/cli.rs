//! The one outbound door into the herdr macrod was started in. Two herdrs
//! exist and macrod drives either:
//!
//! - herdr 0.9 and earlier ([`legacy`]): the `herdr` multiplexer CLI, talking
//!   to the session socket herdr injected into macrod's pane;
//! - herdr-core with the herdr app ([`hc`]): the `hc` CLI, whose terminals
//!   the app shows as tabs.
//!
//! Callers ask for what they need (launch an agent, open a viewer, read a
//! screen) and never see which one answered.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

use super::wire::AgentState;

mod hc;
mod legacy;

#[cfg(test)]
mod test;

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
    /// The agent's terminal is still there, but the agent is not.
    #[error("the agent's herdr terminal no longer runs it")]
    Ended,
    /// The agent started but never reported that it is ready for input.
    #[error("the agent did not become ready; finish any dialog in its Herdr tab")]
    NotReady,
}

impl HerdrError {
    /// Only an explicit missing-agent response permits a native session restart.
    pub(crate) fn missing_agent(&self) -> bool {
        matches!(self, Self::Ended)
            || self.has_code("/error/code", "agent_not_found")
            || self.has_code("/error/kind", "not_found")
    }

    /// The pane is not yet at its shell prompt, e.g. while direnv loads.
    pub(crate) fn pane_busy(&self) -> bool {
        self.has_code("/error/code", "agent_pane_busy")
    }

    fn has_code(&self, pointer: &str, code: &str) -> bool {
        let Self::Refused { stderr, .. } = self else {
            return false;
        };
        serde_json::from_str::<Value>(stderr)
            .ok()
            .is_some_and(|value| value.pointer(pointer).and_then(Value::as_str) == Some(code))
    }
}

/// The tab and root pane a new herdr window opened with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Window {
    /// The tab, e.g. `w1:t2`, or a herdr app tab id.
    pub tab_id: String,
    /// The tab's only pane, e.g. `w1:p2`, or a herdr-core terminal like `t7`.
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
}

/// An agent TUI to start in its own tab.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AgentLaunch<'a> {
    /// Unique name to address the agent by afterwards.
    pub name: &'a str,
    /// The agent's command, which is also herdr's `--kind` for it.
    pub kind: &'a str,
    /// Whether the agent reports its status itself (OSC 7501), so herdr-core
    /// can tell when it is ready.
    pub reports_status: bool,
    /// Where it runs.
    pub cwd: &'a Path,
    /// The tab's label.
    pub label: &'a str,
    /// Switch to the tab.
    pub focus: bool,
    /// For a managed worktree at `cwd`, the repository's main checkout.
    pub worktree_source: Option<&'a Path>,
    /// A private environment file to source before starting the agent.
    pub environment: Option<&'a Path>,
    /// The agent's arguments.
    pub args: &'a [String],
}

/// Drives the herdr session through its CLI.
#[derive(Debug, Clone)]
pub(crate) struct HerdrCli {
    backend: Backend,
}

#[derive(Debug, Clone)]
enum Backend {
    Legacy(legacy::Legacy),
    Core(hc::Core),
}

impl HerdrCli {
    /// Drive the herdr 0.9 session the given binary is attached to, opening
    /// windows in `workspace_id` (herdr's focused workspace when absent).
    pub(crate) fn new(bin: impl Into<PathBuf>, workspace_id: Option<String>) -> Self {
        Self {
            backend: Backend::Legacy(legacy::Legacy {
                bin: bin.into(),
                workspace_id,
            }),
        }
    }

    /// Drive the herdr-core that runs `terminal`, macrod's own terminal.
    pub(crate) fn core(bin: impl Into<PathBuf>, terminal: impl Into<String>) -> Self {
        Self {
            backend: Backend::Core(hc::Core {
                bin: bin.into(),
                terminal: terminal.into(),
                space: Arc::default(),
            }),
        }
    }

    /// Create a fresh worktree of `source` at `path` from the fetched main ref.
    pub(crate) async fn create_worktree(
        &self,
        source: &Path,
        path: &Path,
        branch: &str,
    ) -> rootcause::Result<()> {
        match &self.backend {
            Backend::Legacy(herdr) => Ok(herdr.create_worktree(source, path, branch).await?),
            Backend::Core(herdr) => herdr.create_worktree(source, path, branch).await,
        }
    }

    /// Open a tab for an agent TUI and start it there, returning once it is
    /// ready for input.
    pub(crate) async fn launch_agent(
        &self,
        launch: &AgentLaunch<'_>,
    ) -> Result<Window, HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.launch_agent(launch).await,
            Backend::Core(herdr) => herdr.launch_agent(launch).await,
        }
    }

    /// Open a background tab in `cwd` running `command`.
    pub(crate) async fn open_viewer(
        &self,
        cwd: &Path,
        command: &[String],
    ) -> Result<Window, HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.open_viewer(cwd, command).await,
            Backend::Core(herdr) => herdr.open_viewer(cwd, command).await,
        }
    }

    /// Label a viewer's tab with its session's task.
    pub(crate) async fn name_viewer(&self, window: &Window, title: &str) -> Result<(), HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.name_viewer(window, title).await,
            Backend::Core(herdr) => {
                herdr.name_viewer(window, title).await;
                Ok(())
            }
        }
    }

    /// Report the lifecycle state of the session a viewer shows, which is
    /// what herdr's sidebar and notifications are driven by. Under herdr-core
    /// the viewer reports it itself (OSC 7501), so this does nothing.
    pub(crate) async fn report_state(
        &self,
        window: &Window,
        state: AgentState,
        message: Option<&str>,
        seq: u64,
    ) -> Result<(), HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.report_state(window, state, message, seq).await,
            Backend::Core(_) => Ok(()),
        }
    }

    /// Submit a prompt to a named agent's TUI, returning once it is typed.
    pub(crate) async fn prompt_agent(&self, name: &str, text: &str) -> Result<(), HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.prompt_agent(name, text).await,
            Backend::Core(herdr) => herdr.prompt_agent(name, text).await,
        }
    }

    /// A named agent's lifecycle state and the agent's own session id.
    pub(crate) async fn agent_info(&self, name: &str) -> Result<AgentInfo, HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.agent_info(name).await,
            Backend::Core(herdr) => herdr.agent_info(name).await,
        }
    }

    /// The text a named agent's pane currently shows.
    pub(crate) async fn read_agent(&self, name: &str) -> Result<String, HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.read_agent(name).await,
            Backend::Core(herdr) => herdr.read_agent(name).await,
        }
    }

    /// Press logical keys (`enter`, `esc`, `ctrl+c`) in a named agent's TUI.
    pub(crate) async fn send_keys(&self, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        match &self.backend {
            Backend::Legacy(herdr) => herdr.send_keys(name, keys).await,
            Backend::Core(herdr) => herdr.send_keys(name, keys).await,
        }
    }
}

async fn run<Arg: AsRef<str>>(bin: &Path, args: &[Arg]) -> Result<String, HerdrError> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(150),
        tokio::process::Command::new(bin)
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

fn describe<Arg: AsRef<str>>(args: &[Arg]) -> String {
    args.iter()
        .take(2)
        .map(AsRef::as_ref)
        .collect::<Vec<_>>()
        .join(" ")
}
