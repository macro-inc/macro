//! Where each agent's bare repo lives on the storage volume.

use std::path::{Path, PathBuf};

use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use tokio::process::Command;

/// The storage root and the repo directory naming.
#[derive(Debug, Clone)]
pub struct RepoDirectories {
    root: PathBuf,
}

impl RepoDirectories {
    /// Repos live directly under `root`.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// The storage root (`GIT_PROJECT_ROOT`).
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `<sha256(agent_user_id)>.git`: fixed-length and path-safe, since user
    /// ids contain `|` and `@`.
    pub fn repo_directory_name(&self, agent_user_id: &MacroUserIdStr<'_>) -> String {
        format!(
            "{}.git",
            hex::encode(Sha256::digest(agent_user_id.as_ref().as_bytes()))
        )
    }

    /// Absolute path of the agent's bare repo.
    pub fn repo_path(&self, agent_user_id: &MacroUserIdStr<'_>) -> PathBuf {
        self.root.join(self.repo_directory_name(agent_user_id))
    }
}

/// A `git` invocation that sees none of the service's environment (its
/// secrets) and no system or user git config.
pub(crate) fn git_command() -> Command {
    let mut command = Command::new("git");
    command
        .env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .kill_on_drop(true);
    command
}
