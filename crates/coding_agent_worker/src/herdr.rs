//! Native [herdr](https://herdr.dev) integration.
//!
//! Started from inside a herdr pane (herdr sets `HERDR_ENV=1`), macrod drives
//! the herdr session it lives in: every ACP session it serves opens its own
//! tab in macrod's workspace, rooted at the directory macrod was started
//! from. The tab runs `macrod herdr-pane`, a live terminal view of the session
//! fed from the harness's ACP wire, from which the session can be prompted,
//! interrupted, and have its permission requests answered. herdr's sidebar
//! shows each session as an agent that is working, blocked, or done.
//!
//! The harness still runs under macrod and every session still belongs to
//! Macro: windows steer through the same control API the web app uses.

mod cli;
mod hub;
mod tap;
pub(crate) mod wire;

use std::path::PathBuf;

pub(crate) use hub::Hub;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct HerdrEnv;
    }
    macro_env_var::maybe_env_var! {
        pub struct HerdrBinPath;
    }
    macro_env_var::maybe_env_var! {
        pub struct HerdrWorkspaceId;
    }
}

/// The herdr session macrod was started in.
#[derive(Debug, Clone)]
pub(crate) struct HerdrSession {
    /// The `herdr` binary attached to that session.
    pub bin: PathBuf,
    /// The workspace macrod's pane belongs to; new windows open there.
    pub workspace_id: Option<String>,
}

impl HerdrSession {
    /// The session macrod is running inside, if any.
    pub(crate) fn detect() -> Option<Self> {
        let inside = environment::HerdrEnv::new()
            .is_some_and(|value| value.value() == Some("1"));
        if !inside {
            return None;
        }
        let bin = environment::HerdrBinPath::new()
            .and_then(|path| path.value().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("herdr"));
        let workspace_id = environment::HerdrWorkspaceId::new()
            .and_then(|id| id.value().map(str::to_owned))
            .filter(|id| !id.is_empty());
        Some(Self { bin, workspace_id })
    }
}
