//! The git commands a boot runs, as typed values: nothing else reaches
//! git's command line.

use std::ffi::OsString;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::process::{self, Limits, ProcessError};
use crate::boot::CommitId;

/// How long a clone may take.
const CLONE_DEADLINE: Duration = Duration::from_secs(10 * 60);

/// How long any other command may take.
const COMMAND_DEADLINE: Duration = Duration::from_secs(60);

/// The most output read from one command: a package.json or a bun.lock.
pub const MAX_OUTPUT: usize = 32 * 1024 * 1024;

/// One git command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCommand {
    /// Clone `url` into `into`, with the credential helper as the only one.
    Clone {
        /// The repository, without credentials.
        url: String,
        /// A fresh directory.
        into: PathBuf,
    },
    /// Point `origin` at `url`.
    SetOrigin {
        /// The repository.
        url: String,
    },
    /// Drop the workspace's credential helpers: an empty entry, which also
    /// resets inherited ones.
    ResetCredentialHelpers,
    /// Add the credential helper. The config stores the helper and the
    /// credential file's path, never the token.
    AddCredentialHelper,
    /// Set one local config value.
    SetConfig {
        /// Its key.
        key: ConfigKey,
        /// Its value.
        value: String,
    },
    /// `rev-parse --verify HEAD`.
    Head,
    /// The repository's first commits (`rev-list --max-parents=0 HEAD`).
    RootCommits,
    /// A file at a commit (`show <commit>:<path>`).
    Show {
        /// The commit.
        commit: CommitId,
        /// The file, from the repository's root.
        path: RepositoryFile,
    },
    /// A commit of `tree_of`'s tree on top of `parent`.
    CommitTree {
        /// Whose tree.
        tree_of: CommitId,
        /// The parent.
        parent: CommitId,
        /// The message.
        message: String,
    },
    /// `reset --hard --quiet <commit>`.
    ResetHard {
        /// Where to.
        commit: CommitId,
    },
    /// Commit `bun.lock`, as it is in the workspace.
    CommitLock {
        /// The message.
        message: String,
    },
}

/// The config keys a boot sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ConfigKey {
    /// `credential.useHttpPath`.
    #[strum(serialize = "credential.useHttpPath")]
    UseHttpPath,
    /// `user.name`.
    #[strum(serialize = "user.name")]
    UserName,
    /// `user.email`.
    #[strum(serialize = "user.email")]
    UserEmail,
}

/// The files of the repository a boot reads at a commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum RepositoryFile {
    /// `package.json`.
    #[strum(serialize = "package.json")]
    PackageJson,
    /// `bun.lock`.
    #[strum(serialize = "bun.lock")]
    BunLock,
}

/// A git command that failed.
#[derive(Debug, thiserror::Error)]
#[error("git {command}: {source}")]
pub struct GitError {
    /// Which command, by name.
    pub command: &'static str,
    /// How it failed.
    #[source]
    pub source: ProcessError,
}

/// Runs git commands.
pub trait Git: Send + Sync {
    /// Run `command`; its stdout.
    fn run(&self, command: GitCommand) -> impl Future<Output = Result<Vec<u8>, GitError>> + Send;
}

/// git as a child process, on one workspace.
#[derive(Debug, Clone)]
pub struct ProcessGit {
    /// The `git` program.
    pub program: PathBuf,
    /// The workspace every command but a clone runs in.
    pub workspace: PathBuf,
    /// `!<helper> <credentials file>`: the credential helper command.
    pub helper_command: String,
}

impl ProcessGit {
    /// The git of a workspace, with `helper` reading `helper_credentials`.
    pub fn new(workspace: PathBuf, helper: &Path, helper_credentials: &Path) -> Self {
        Self {
            program: PathBuf::from("git"),
            workspace,
            helper_command: format!("!{} {}", helper.display(), helper_credentials.display()),
        }
    }

    /// The arguments after `git`, and the command's name.
    pub fn arguments(&self, command: &GitCommand) -> (&'static str, Vec<OsString>) {
        let mut arguments: Vec<OsString> = Vec::new();
        let workspace = |arguments: &mut Vec<OsString>| {
            // Hooks are files the agent writes: none ever runs here.
            arguments.extend(
                [
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "commit.gpgsign=false",
                    "-C",
                ]
                .map(OsString::from),
            );
            arguments.push(self.workspace.clone().into_os_string());
        };
        let name = match command {
            GitCommand::Clone { url, into } => {
                arguments.extend(
                    [
                        "-c".to_owned(),
                        "credential.useHttpPath=true".to_owned(),
                        "-c".to_owned(),
                        "credential.helper=".to_owned(),
                        "-c".to_owned(),
                        format!("credential.helper={}", self.helper_command),
                        "-c".to_owned(),
                        "core.hooksPath=/dev/null".to_owned(),
                        "clone".to_owned(),
                        "--".to_owned(),
                        url.clone(),
                    ]
                    .map(OsString::from),
                );
                arguments.push(into.clone().into_os_string());
                "clone"
            }
            GitCommand::SetOrigin { url } => {
                workspace(&mut arguments);
                arguments.extend(["remote", "set-url", "origin", url].map(OsString::from));
                "remote set-url"
            }
            GitCommand::ResetCredentialHelpers => {
                workspace(&mut arguments);
                arguments.extend(
                    [
                        "config",
                        "--local",
                        "--replace-all",
                        "credential.helper",
                        "",
                    ]
                    .map(OsString::from),
                );
                "config credential.helper"
            }
            GitCommand::AddCredentialHelper => {
                workspace(&mut arguments);
                arguments.extend(
                    [
                        "config",
                        "--local",
                        "--add",
                        "credential.helper",
                        &self.helper_command,
                    ]
                    .map(OsString::from),
                );
                "config credential.helper"
            }
            GitCommand::SetConfig { key, value } => {
                workspace(&mut arguments);
                let key: &'static str = key.into();
                arguments.extend(["config", "--local", key, value].map(OsString::from));
                "config"
            }
            GitCommand::Head => {
                workspace(&mut arguments);
                arguments.extend(["rev-parse", "--verify", "HEAD"].map(OsString::from));
                "rev-parse"
            }
            GitCommand::RootCommits => {
                workspace(&mut arguments);
                arguments.extend(["rev-list", "--max-parents=0", "HEAD"].map(OsString::from));
                "rev-list"
            }
            GitCommand::Show { commit, path } => {
                workspace(&mut arguments);
                let path: &'static str = path.into();
                arguments.push("show".into());
                arguments.push(format!("{commit}:{path}").into());
                "show"
            }
            GitCommand::CommitTree {
                tree_of,
                parent,
                message,
            } => {
                workspace(&mut arguments);
                arguments.extend(
                    [
                        "commit-tree".to_owned(),
                        format!("{tree_of}^{{tree}}"),
                        "-p".to_owned(),
                        parent.to_string(),
                        "-m".to_owned(),
                        message.clone(),
                    ]
                    .map(OsString::from),
                );
                "commit-tree"
            }
            GitCommand::ResetHard { commit } => {
                workspace(&mut arguments);
                arguments
                    .extend(["reset", "--hard", "--quiet", commit.as_str()].map(OsString::from));
                "reset"
            }
            GitCommand::CommitLock { message } => {
                workspace(&mut arguments);
                arguments.extend(
                    ["commit", "--quiet", "--message", message, "--", "bun.lock"]
                        .map(OsString::from),
                );
                "commit"
            }
        };
        (name, arguments)
    }

    async fn spawn(
        &self,
        name: &'static str,
        arguments: Vec<OsString>,
        deadline: Duration,
    ) -> Result<Vec<u8>, GitError> {
        let mut command = tokio::process::Command::new(&self.program);
        command.args(arguments).env("GIT_TERMINAL_PROMPT", "0");
        let limits = Limits {
            deadline,
            max_output: MAX_OUTPUT,
        };
        process::run(command, limits)
            .await
            .map_err(|source| GitError {
                command: name,
                source,
            })
    }
}

impl Git for ProcessGit {
    async fn run(&self, command: GitCommand) -> Result<Vec<u8>, GitError> {
        let deadline = if matches!(command, GitCommand::Clone { .. }) {
            CLONE_DEADLINE
        } else {
            COMMAND_DEADLINE
        };
        let (name, arguments) = self.arguments(&command);
        self.spawn(name, arguments, deadline).await
    }
}
