//! Native [herdr](https://herdr.dev) integration.
//!
//! Started from inside herdr, macrod drives the herdr it lives in: either a
//! herdr 0.9 pane (`HERDR_ENV=1`) or a herdr-core terminal shown by the herdr
//! app (`HC_TERMINAL_ID`; see [`cli`]). Every ACP session it serves opens its
//! own tab in macrod's workspace or space, rooted at the directory macrod was started
//! from. The tab runs `macrod herdr-pane`, a live terminal view of the session
//! fed from the harness's ACP wire, from which the session can be prompted,
//! interrupted, and have its permission requests answered. herdr's sidebar
//! shows each session as an agent that is working, blocked, or done.
//!
//! The harness still runs under macrod and every session still belongs to
//! Macro: windows steer through the same control API the web app uses.
//!
//! With `macrod herdr-acp` as the harness, the window instead hosts the real
//! Claude Code or Codex TUI, driven over ACP by that adapter (see
//! [`acp_agent`]).

pub(crate) mod acp_agent;
pub(crate) mod cli;
mod controls;
mod hub;
mod mcp;
pub(crate) mod repositories;
mod store;
mod tail;
mod tap;
pub(crate) mod wire;

#[cfg(test)]
mod test;

use std::path::PathBuf;

pub(crate) use hub::Hub;

use crate::config::Harness;

/// herdr-core's CLI, which its installer puts on PATH.
const CORE_COMMAND: &str = "hc";

/// Whether the harness is `macrod herdr-acp`, which opens its own herdr
/// windows for real agent TUIs, so no session needs a viewer window.
pub(crate) fn drives_herdr(harness: &Harness) -> bool {
    harness.args.first().map(String::as_str) == Some(acp_agent::SUBCOMMAND)
}

/// The TUI a `macrod herdr-acp` harness runs, if the harness is one.
pub(crate) fn herdr_agent(harness: &Harness) -> Option<acp_agent::TuiAgent> {
    if !drives_herdr(harness) {
        return None;
    }
    let mut args = harness.args.iter().skip(1).map(String::as_str);
    while let Some(arg) = args.next() {
        let kind = match arg {
            "--" => break,
            "--kind" => args.next(),
            arg => arg.strip_prefix("--kind="),
        };
        if let Some(kind) = kind {
            return <acp_agent::TuiAgent as clap::ValueEnum>::from_str(kind, true).ok();
        }
    }
    Some(acp_agent::TuiAgent::default())
}

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
    macro_env_var::maybe_env_var! {
        pub struct HerdrEnv;
    }
    macro_env_var::maybe_env_var! {
        pub struct HerdrBinPath;
    }
    macro_env_var::maybe_env_var! {
        pub struct HerdrWorkspaceId;
    }
    macro_env_var::maybe_env_var! {
        pub struct HcTerminalId;
    }
}

/// Private state for one paired daemon; shared by its dispatcher and ACP process.
pub(crate) fn instance_directory(id: impl std::fmt::Display) -> rootcause::Result<PathBuf> {
    let home = environment::Home::new()
        .and_then(|value| value.value().map(PathBuf::from))
        .ok_or_else(|| rootcause::report!("HOME is required for Herdr storage"))?;
    Ok(home.join(".macrod/herdr").join(id.to_string()))
}

/// The herdr macrod was started in.
#[derive(Debug, Clone)]
pub(crate) enum HerdrSession {
    /// A pane of herdr 0.9 or earlier.
    Legacy {
        /// The `herdr` binary attached to that session.
        bin: PathBuf,
        /// The workspace macrod's pane belongs to; new windows open there.
        workspace_id: Option<String>,
    },
    /// A herdr-core terminal, usually shown by the herdr app.
    Core {
        /// macrod's own terminal address, e.g. `t3`.
        terminal: String,
    },
}

impl HerdrSession {
    /// The herdr macrod is running inside, if any. herdr-core comes first:
    /// a core started from an old herdr pane passes `HERDR_ENV` on to its
    /// terminals.
    pub(crate) fn detect() -> Option<Self> {
        if let Some(terminal) = environment::HcTerminalId::new()
            .and_then(|id| id.value().map(str::to_owned))
            .filter(|id| !id.is_empty())
        {
            return Some(Self::Core { terminal });
        }
        let inside = environment::HerdrEnv::new().is_some_and(|value| value.value() == Some("1"));
        if !inside {
            return None;
        }
        let bin = environment::HerdrBinPath::new()
            .and_then(|path| path.value().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("herdr"));
        let workspace_id = environment::HerdrWorkspaceId::new()
            .and_then(|id| id.value().map(str::to_owned))
            .filter(|id| !id.is_empty());
        Some(Self::Legacy { bin, workspace_id })
    }

    /// The command this herdr is driven through.
    pub(crate) fn command(&self) -> &'static str {
        match self {
            Self::Legacy { .. } => "herdr",
            Self::Core { .. } => CORE_COMMAND,
        }
    }

    /// A client for this herdr.
    pub(crate) fn cli(&self) -> cli::HerdrCli {
        match self {
            Self::Legacy { bin, workspace_id } => cli::HerdrCli::new(bin, workspace_id.clone()),
            Self::Core { terminal } => cli::HerdrCli::core(CORE_COMMAND, terminal.clone()),
        }
    }

    /// Whether panes report their own status (OSC 7501) instead of macrod
    /// reporting it for them.
    pub(crate) fn panes_report_status(&self) -> bool {
        matches!(self, Self::Core { .. })
    }
}

/// Apply the instance defaults without mixing adapter flags with native arguments.
pub(crate) fn configure_launch(
    harness: &mut crate::config::Harness,
    settings: &crate::config::HerdrSettings,
    state_dir: &std::path::Path,
) {
    let index = harness
        .args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(harness.args.len());
    let mut flags = vec![
        "--state-dir".to_owned(),
        state_dir.to_string_lossy().into_owned(),
        "--managed-worktrees".to_owned(),
    ];
    if let Some(model) = &settings.model {
        flags.push(format!("--model={model}"));
    }
    if !settings.focus {
        flags.push("--no-focus".to_owned());
    }
    harness.args.splice(index..index, flags);
    if !settings.arguments.is_empty() {
        if !harness.args.iter().any(|arg| arg == "--") {
            harness.args.push("--".to_owned());
        }
        harness.args.extend(settings.arguments.iter().cloned());
    }
}
