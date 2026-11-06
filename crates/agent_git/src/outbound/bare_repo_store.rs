//! Bare repos under a storage root, managed with the `git` CLI.

use std::path::{Path, PathBuf};

use macro_user_id::user_id::MacroUserIdStr;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::domain::ports::RepoStore;
use crate::domain::template::RenderedFile;
use crate::outbound::repo_directories::{RepoDirectories, git_command};

/// Branch every repo starts on.
const INITIAL_BRANCH: &str = "main";
/// Author of the initial commit.
const INITIAL_AUTHOR_NAME: &str = "Macro";
const INITIAL_AUTHOR_EMAIL: &str = "agents@macro.com";
const INITIAL_COMMIT_MESSAGE: &str = "Initial workspace";

/// Errors from [`BareRepoStore`].
#[derive(Debug, thiserror::Error)]
pub enum BareRepoStoreError {
    /// The selected voice file is malformed.
    #[error("invalid voice configuration: {0}")]
    Voice(#[from] serde_json::Error),
    /// A filesystem operation failed.
    #[error("{action} {path}: {source}")]
    Io {
        /// What was attempted.
        action: &'static str,
        /// On which path.
        path: PathBuf,
        /// The error.
        source: std::io::Error,
    },
    /// A `git` command exited unsuccessfully.
    #[error("git {command} failed: {stderr}")]
    Git {
        /// The subcommand.
        command: &'static str,
        /// Its stderr.
        stderr: String,
    },
    /// The size walk task did not finish.
    #[error("repo size measurement did not finish: {0}")]
    SizeTask(#[from] tokio::task::JoinError),
}

fn io_error(
    action: &'static str,
    path: &Path,
) -> impl FnOnce(std::io::Error) -> BareRepoStoreError {
    let path = path.to_path_buf();
    move |source| BareRepoStoreError::Io {
        action,
        path,
        source,
    }
}

/// [`RepoStore`] on a directory (EFS in AWS, a docker volume locally).
#[derive(Debug, Clone)]
pub struct BareRepoStore {
    directories: RepoDirectories,
}

impl BareRepoStore {
    /// Repos live under `directories`' root, which must exist.
    pub fn new(directories: RepoDirectories) -> Self {
        Self { directories }
    }
}

async fn run_git(
    command: &'static str,
    build: impl FnOnce(&mut tokio::process::Command),
) -> Result<(), BareRepoStoreError> {
    let mut git = git_command();
    build(&mut git);

    let output = git
        .output()
        .await
        .map_err(|source| BareRepoStoreError::Io {
            action: "run git",
            path: PathBuf::from(command),
            source,
        })?;

    if !output.status.success() {
        return Err(BareRepoStoreError::Git {
            command,
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        });
    }

    Ok(())
}

/// Write `files` into `work_tree` and commit them into `git_dir`.
async fn commit_template(
    git_dir: &Path,
    work_tree: &Path,
    files: &[RenderedFile],
) -> Result<(), BareRepoStoreError> {
    for file in files {
        let path = work_tree.join(file.path);

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(io_error("create template directory", parent))?;
        }

        tokio::fs::write(&path, &file.contents)
            .await
            .map_err(io_error("write template file", &path))?;
    }

    run_git("add", |git| {
        git.arg("--git-dir")
            .arg(git_dir)
            .arg("--work-tree")
            .arg(work_tree)
            .args(["add", "--all"]);
    })
    .await?;

    run_git("commit", |git| {
        git.arg("--git-dir")
            .arg(git_dir)
            .arg("--work-tree")
            .arg(work_tree)
            .args(["-c", &format!("user.name={INITIAL_AUTHOR_NAME}")])
            .args(["-c", &format!("user.email={INITIAL_AUTHOR_EMAIL}")])
            .args(["commit", "--quiet", "--message", INITIAL_COMMIT_MESSAGE]);
    })
    .await
}

fn directory_size_bytes(path: &Path) -> std::io::Result<u64> {
    let mut total = 0;

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;

        if metadata.is_dir() {
            total += directory_size_bytes(&entry.path())?;
        } else {
            total += metadata.len();
        }
    }

    Ok(total)
}

impl RepoStore for BareRepoStore {
    type Err = BareRepoStoreError;

    #[tracing::instrument(skip_all, err)]
    async fn voice(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<crate::domain::voice::VoiceConfig, Self::Err> {
        let repo = self.directories.repo_path(agent_user_id);
        let output = git_command()
            .arg("--git-dir")
            .arg(&repo)
            .args(["show", "main:config/voice.json"])
            .output()
            .await
            .map_err(io_error("read voice", &repo))?;
        if !output.status.success() {
            return Err(BareRepoStoreError::Git {
                command: "show",
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(serde_json::from_slice(&output.stdout)?)
    }

    #[tracing::instrument(skip_all, err)]
    async fn set_voice(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        voice: &crate::domain::voice::VoiceConfig,
    ) -> Result<(), Self::Err> {
        let repo = self.directories.repo_path(agent_user_id);
        let scratch = self
            .directories
            .root()
            .join(format!(".voice-{}", Uuid::now_v7()));
        let result = async {
            run_git("clone", |git| {
                git.args(["clone", "--quiet", "--no-hardlinks", "--branch", "main"])
                    .arg(&repo)
                    .arg(&scratch);
            })
            .await?;
            let config = scratch.join("config");
            match tokio::fs::symlink_metadata(&config).await {
                Ok(metadata) if !metadata.is_dir() => {
                    return Err(io_error("validate config directory", &config)(
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "config must be a directory",
                        ),
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::fs::create_dir(&config)
                        .await
                        .map_err(io_error("create config", &config))?;
                }
                Err(error) => return Err(io_error("inspect config", &config)(error)),
            }
            let file = config.join("voice.json");
            let temporary = config.join(format!(".voice-{}", Uuid::now_v7()));
            let mut output = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .await
                .map_err(io_error("create voice", &temporary))?;
            output
                .write_all(format!("{}\n", serde_json::to_string_pretty(voice)?).as_bytes())
                .await
                .map_err(io_error("write voice", &temporary))?;
            drop(output);
            tokio::fs::rename(&temporary, &file)
                .await
                .map_err(io_error("replace voice", &file))?;
            run_git("add", |git| {
                git.arg("-C")
                    .arg(&scratch)
                    .args(["add", "--", "config/voice.json"]);
            })
            .await?;
            let diff = git_command()
                .arg("-C")
                .arg(&scratch)
                .args(["diff", "--cached", "--quiet"])
                .status()
                .await
                .map_err(io_error("compare voice", &scratch))?;
            if diff.success() {
                return Ok(());
            }
            run_git("commit", |git| {
                git.arg("-C").arg(&scratch).args([
                    "-c",
                    "user.name=Macro",
                    "-c",
                    "user.email=agents@macro.com",
                    "commit",
                    "--quiet",
                    "--message",
                    "Set agent voice",
                ]);
            })
            .await?;
            // Compare-and-swap pushes preserve commits arriving through smart HTTP.
            for _ in 0..3 {
                let pushed = run_git("push", |git| {
                    git.arg("-C")
                        .arg(&scratch)
                        .args(["push", "--quiet", "origin", "HEAD:main"]);
                })
                .await;
                if pushed.is_ok() {
                    return Ok(());
                }
                run_git("pull", |git| {
                    git.arg("-C")
                        .arg(&scratch)
                        .args(["pull", "--rebase", "--quiet", "origin", "main"]);
                })
                .await?;
            }
            Err(BareRepoStoreError::Git {
                command: "push",
                stderr: "voice change raced repeated repository updates".to_owned(),
            })
        }
        .await;
        let cleanup = tokio::fs::remove_dir_all(&scratch).await;
        if let Err(error) = cleanup {
            tracing::warn!(error = ?error, "voice scratch cleanup failed");
        }
        result
    }

    #[tracing::instrument(skip_all, err)]
    async fn create_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        files: &[RenderedFile],
    ) -> Result<(), BareRepoStoreError> {
        let repo_path = self.directories.repo_path(agent_user_id);

        if tokio::fs::try_exists(&repo_path)
            .await
            .map_err(io_error("check repo", &repo_path))?
        {
            return Ok(());
        }

        // Build under a scratch name and rename into place, so a half-built
        // repo is never served and a retry starts clean.
        let staging = self
            .directories
            .root()
            .join(format!(".staging-{}", Uuid::now_v7()));
        let git_dir = staging.join("repo.git");
        let work_tree = staging.join("work");

        tokio::fs::create_dir_all(&work_tree)
            .await
            .map_err(io_error("create staging directory", &work_tree))?;

        let built = async {
            run_git("init", |git| {
                git.args([
                    "init",
                    "--quiet",
                    "--bare",
                    "--initial-branch",
                    INITIAL_BRANCH,
                ])
                .arg(&git_dir);
            })
            .await?;

            commit_template(&git_dir, &work_tree, files).await?;

            match tokio::fs::rename(&git_dir, &repo_path).await {
                Ok(()) => Ok(()),
                // A concurrent create won the rename; its repo stands.
                Err(_) if tokio::fs::try_exists(&repo_path).await.unwrap_or(false) => Ok(()),
                Err(source) => Err(BareRepoStoreError::Io {
                    action: "move repo into place",
                    path: repo_path.clone(),
                    source,
                }),
            }
        }
        .await;

        let cleaned = tokio::fs::remove_dir_all(&staging)
            .await
            .map_err(io_error("remove staging directory", &staging));

        built?;
        cleaned
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), BareRepoStoreError> {
        let repo_path = self.directories.repo_path(agent_user_id);
        let tombstone = self
            .directories
            .root()
            .join(format!(".deleted-{}", Uuid::now_v7()));

        // Rename first so a partly removed repo is never served.
        match tokio::fs::rename(&repo_path, &tombstone).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(source) => {
                return Err(BareRepoStoreError::Io {
                    action: "retire repo",
                    path: repo_path,
                    source,
                });
            }
        }

        tokio::fs::remove_dir_all(&tombstone)
            .await
            .map_err(io_error("remove retired repo", &tombstone))
    }

    #[tracing::instrument(skip_all, err)]
    async fn repo_size_bytes(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<u64, BareRepoStoreError> {
        let repo_path = self.directories.repo_path(agent_user_id);
        let walked = repo_path.clone();

        tokio::task::spawn_blocking(move || directory_size_bytes(&walked))
            .await?
            .map_err(io_error("measure repo", &repo_path))
    }
}
