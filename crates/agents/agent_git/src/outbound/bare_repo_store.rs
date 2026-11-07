//! Bare repos under a storage root, managed with the `git` CLI.

use std::os::unix::fs::PermissionsExt;
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

/// Run git, feeding it `stdin`, and return its trimmed stdout.
async fn git_stdout(
    command: &'static str,
    stdin: Option<&[u8]>,
    build: impl FnOnce(&mut tokio::process::Command),
) -> Result<String, BareRepoStoreError> {
    let mut git = git_command();
    build(&mut git);
    git.stdin(if stdin.is_some() {
        std::process::Stdio::piped()
    } else {
        std::process::Stdio::null()
    })
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

    let io = |source| BareRepoStoreError::Io {
        action: "run git",
        path: PathBuf::from(command),
        source,
    };
    let mut child = git.spawn().map_err(io)?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input).await.map_err(io)?;
    }
    let output = child.wait_with_output().await.map_err(io)?;

    if !output.status.success() {
        return Err(BareRepoStoreError::Git {
            command,
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// The commit `main` points at.
async fn main_commit(repo: &Path) -> Result<String, BareRepoStoreError> {
    git_stdout("rev-parse", None, |git| {
        git.arg("--git-dir")
            .arg(repo)
            .args(["rev-parse", "--verify", "refs/heads/main^{commit}"]);
    })
    .await
}

/// How many times a server commit retries after a push moved `main` under it.
const COMMIT_ATTEMPTS: usize = 3;

/// Mode of a template file git records as executable.
const EXECUTABLE_MODE: u32 = 0o755;

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
        if file.executable {
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(EXECUTABLE_MODE))
                .await
                .map_err(io_error("mark template file executable", &path))?;
        }
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

    #[tracing::instrument(skip_all, fields(path = %path), err)]
    async fn read_file(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        path: &str,
    ) -> Result<Option<Vec<u8>>, BareRepoStoreError> {
        let repo = self.directories.repo_path(agent_user_id);
        let Some(entry) = tree_entry(&repo, path).await? else {
            return Ok(None);
        };
        if entry.mode != REGULAR_FILE_MODE {
            return Ok(None);
        }

        let output = git_command()
            .arg("--git-dir")
            .arg(&repo)
            .args(["cat-file", "blob", &entry.object])
            .output()
            .await
            .map_err(io_error("read file", &repo))?;
        if !output.status.success() {
            return Err(BareRepoStoreError::Git {
                command: "cat-file",
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }

        Ok(Some(output.stdout))
    }

    /// Builds the commit with plumbing on a private index, never a work
    /// tree, so nothing the agent committed (symlinks included) is ever
    /// checked out or followed. `update-ref` with the old value is a
    /// compare-and-swap: a push that lands first is kept and the commit is
    /// rebuilt on top of it.
    #[tracing::instrument(skip_all, fields(path = %path, attempts = tracing::field::Empty), err)]
    async fn commit_file(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        path: &str,
        contents: &[u8],
        message: &str,
    ) -> Result<(), BareRepoStoreError> {
        let repo = self.directories.repo_path(agent_user_id);
        let index = self
            .directories
            .root()
            .join(format!(".index-{}", Uuid::now_v7()));

        let committed = async {
            let blob = git_stdout("hash-object", Some(contents), |git| {
                git.arg("--git-dir")
                    .arg(&repo)
                    .args(["hash-object", "-w", "--stdin"]);
            })
            .await?;

            for attempt in 1..=COMMIT_ATTEMPTS {
                tracing::Span::current().record("attempts", attempt);
                let parent = main_commit(&repo).await?;

                let current = tree_entry(&repo, path).await?;
                if current
                    .is_some_and(|entry| entry.mode == REGULAR_FILE_MODE && entry.object == blob)
                {
                    return Ok(());
                }

                let indexed = |git: &mut tokio::process::Command| {
                    git.env("GIT_INDEX_FILE", &index)
                        .arg("--git-dir")
                        .arg(&repo);
                };
                git_stdout("read-tree", None, |git| {
                    indexed(git);
                    git.args(["read-tree", &parent]);
                })
                .await?;
                // Without `--replace`, a path whose parent is a file or
                // symlink in the tree is refused instead of replaced.
                git_stdout("update-index", None, |git| {
                    indexed(git);
                    git.args([
                        "update-index",
                        "--add",
                        "--cacheinfo",
                        &format!("{REGULAR_FILE_MODE},{blob},{path}"),
                    ]);
                })
                .await?;
                let tree = git_stdout("write-tree", None, |git| {
                    indexed(git);
                    git.arg("write-tree");
                })
                .await?;
                let commit = git_stdout("commit-tree", None, |git| {
                    git.arg("--git-dir")
                        .arg(&repo)
                        .args(["-c", &format!("user.name={INITIAL_AUTHOR_NAME}")])
                        .args(["-c", &format!("user.email={INITIAL_AUTHOR_EMAIL}")])
                        .args(["commit-tree", &tree, "-p", &parent, "-m", message]);
                })
                .await?;

                let swapped = git_stdout("update-ref", None, |git| {
                    git.arg("--git-dir").arg(&repo).args([
                        "update-ref",
                        "refs/heads/main",
                        &commit,
                        &parent,
                    ]);
                })
                .await;
                // git exits 128 for a lost swap and for real failures alike;
                // only a moved `main` is worth another attempt.
                let Err(error) = swapped else {
                    return Ok(());
                };
                if main_commit(&repo).await? == parent {
                    return Err(error);
                }
            }

            Err(BareRepoStoreError::Git {
                command: "update-ref",
                stderr: "main kept moving during the server commit".to_owned(),
            })
        }
        .await;

        match tokio::fs::remove_file(&index).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(error = ?error, "could not remove a server commit's index")
            }
        }

        committed
    }
}

/// Mode git records for a regular, non-executable file.
const REGULAR_FILE_MODE: &str = "100644";

/// One entry of `main`'s tree.
struct TreeEntry {
    mode: String,
    object: String,
}

/// The entry at `path` on `main`, if any; a symlinked parent directory is
/// not followed, so its children are missing.
async fn tree_entry(repo: &Path, path: &str) -> Result<Option<TreeEntry>, BareRepoStoreError> {
    let listed = git_stdout("ls-tree", None, |git| {
        git.arg("--git-dir").arg(repo).args([
            "ls-tree",
            "--full-tree",
            "refs/heads/main",
            "--",
            path,
        ]);
    })
    .await?;

    // `<mode> <type> <object>\t<path>`; empty when the path is missing.
    let Some((meta, listed_path)) = listed.split_once('\t') else {
        return Ok(None);
    };
    let mut fields = meta.split(' ');
    match (fields.next(), fields.next(), fields.next()) {
        (Some(mode), Some(_), Some(object)) if listed_path == path => Ok(Some(TreeEntry {
            mode: mode.to_owned(),
            object: object.to_owned(),
        })),
        _ => Ok(None),
    }
}
