//! A herdr pane on the computer, driven through the `herdr` CLI.
//!
//! macrod runs as a system service outside any herdr session, so it starts
//! the user's headless `herdr server` itself when none is running. The pane
//! lives in its own workspace, which a person can attach to and watch.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use rootcause::prelude::ResultExt as _;
use serde::Deserialize;

/// How long one CLI call may take.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a freshly spawned server may take to accept connections.
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(10);
const SERVER_POLL: Duration = Duration::from_millis(200);

/// The herdr CLI on this computer.
#[derive(Debug, Clone)]
pub struct Herdr {
    bin: PathBuf,
}

/// One pane in a workspace macrod created.
#[derive(Debug)]
pub struct Pane {
    herdr: Herdr,
    workspace_id: String,
    pane_id: String,
}

#[derive(Deserialize)]
struct Response<Result> {
    result: Result,
}

#[derive(Deserialize)]
struct WorkspaceCreated {
    root_pane: RootPane,
    workspace: Workspace,
}

#[derive(Deserialize)]
struct RootPane {
    pane_id: String,
}

#[derive(Deserialize)]
struct Workspace {
    workspace_id: String,
}

impl Herdr {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    /// Start the headless server unless one is already running.
    pub async fn ensure_server(&self) -> rootcause::Result<()> {
        if self.server_running().await {
            return Ok(());
        }
        let mut command = tokio::process::Command::new(&self.bin);
        command
            .arg("server")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        command.process_group(0);
        command
            .spawn()
            .context("could not start the herdr server")?;
        let deadline = tokio::time::Instant::now() + SERVER_START_TIMEOUT;
        while tokio::time::Instant::now() < deadline {
            if self.server_running().await {
                return Ok(());
            }
            tokio::time::sleep(SERVER_POLL).await;
        }
        rootcause::bail!("the herdr server did not start")
    }

    async fn server_running(&self) -> bool {
        self.run(&["status", "server"])
            .await
            .is_ok_and(|output| output.lines().any(|line| line.trim() == "status: running"))
    }

    /// A new background workspace labelled `label`, with one pane in `cwd`.
    pub async fn open_workspace(&self, label: &str, cwd: &Path) -> rootcause::Result<Pane> {
        let cwd = cwd.to_string_lossy();
        let output = self
            .run(&[
                "workspace",
                "create",
                "--label",
                label,
                "--cwd",
                cwd.as_ref(),
                "--no-focus",
            ])
            .await?;
        let created: Response<WorkspaceCreated> =
            serde_json::from_str(&output).context("herdr answered an unexpected workspace")?;
        Ok(Pane {
            herdr: self.clone(),
            workspace_id: created.result.workspace.workspace_id,
            pane_id: created.result.root_pane.pane_id,
        })
    }

    async fn run(&self, args: &[&str]) -> rootcause::Result<String> {
        let output = tokio::time::timeout(
            COMMAND_TIMEOUT,
            tokio::process::Command::new(&self.bin)
                .args(args)
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| rootcause::report!("herdr {} timed out", args[0]))?
        .context("could not run herdr")?;
        if !output.status.success() {
            rootcause::bail!(
                "herdr {} failed: {}",
                args[0],
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

impl Pane {
    /// Run a shell command line in the pane.
    pub async fn run(&self, command: &str) -> rootcause::Result<()> {
        self.herdr
            .run(&["pane", "run", &self.pane_id, command])
            .await
            .map(drop)
    }

    /// The text the pane shows now.
    pub async fn screen(&self) -> rootcause::Result<String> {
        self.herdr
            .run(&["pane", "read", &self.pane_id, "--source", "visible"])
            .await
    }

    /// Type `text` without pressing Enter.
    pub async fn type_text(&self, text: &str) -> rootcause::Result<()> {
        self.herdr
            .run(&["pane", "send-text", &self.pane_id, text])
            .await
            .map(drop)
    }

    /// Press logical keys (`enter`, `down`, `escape`).
    pub async fn press(&self, keys: &[&str]) -> rootcause::Result<()> {
        let mut args = vec!["pane", "send-keys", &self.pane_id];
        args.extend_from_slice(keys);
        self.herdr.run(&args).await.map(drop)
    }

    /// Close the workspace and everything running in it.
    pub async fn close(self) -> rootcause::Result<()> {
        self.herdr
            .run(&["workspace", "close", &self.workspace_id])
            .await
            .map(drop)
    }
}
