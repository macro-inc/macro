//! How the git source reads a repository: the `git` CLI, behind a trait so
//! unit tests answer from literals. Every call is a ref or commit-graph read
//! with optional locks off; nothing here writes to a repository, fetches,
//! or reads a working tree.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;

use crate::domain::model::{Oid, Timestamp};
use crate::outbound::git::parse::{self, LogLine, RawCommit, RefRow};

/// How long one `git` call may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(5);

/// Why a git read failed.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    /// No `git` program was found.
    #[error("git not found")]
    NotFound,
    /// `git` ran and failed, or timed out.
    #[error("git failed: {0}")]
    Failed(String),
}

/// A working directory resolved to its repository.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Discovered {
    /// The canonical git common directory, shared by every worktree.
    pub common_dir: PathBuf,
}

/// The reads one gather makes. `repo` is always a common directory.
pub trait GitBackend: Clone + Send + Sync + 'static {
    /// The repository holding `cwd`, if it is inside a checkout.
    fn discover(&self, cwd: PathBuf) -> impl Future<Output = Option<Discovered>> + Send;

    /// Every local branch and `origin` remote ref.
    fn refs(&self, repo: PathBuf) -> impl Future<Output = Result<Vec<RefRow>, GitError>> + Send;

    /// `(ahead, behind)` of each of `refs` against `trunk`, by full ref name.
    fn ahead_behind(
        &self,
        repo: PathBuf,
        trunk: String,
        refs: Vec<String>,
    ) -> impl Future<Output = Result<BTreeMap<String, (u32, u32)>, GitError>> + Send;

    /// The trunk's newest `max` first-parent commits, newest first.
    fn trunk_log(
        &self,
        repo: PathBuf,
        trunk: String,
        max: usize,
    ) -> impl Future<Output = Result<Vec<RawCommit>, GitError>> + Send;

    /// Commits reachable from `tips` and not from `trunk`, at most `max`,
    /// with the boundary commits where the walk stopped.
    fn lane_log(
        &self,
        repo: PathBuf,
        trunk: String,
        tips: Vec<Oid>,
        max: usize,
    ) -> impl Future<Output = Result<Vec<LogLine>, GitError>> + Send;

    /// The merge-base of `trunk` and `tip`, and its commit time.
    fn merge_base(
        &self,
        repo: PathBuf,
        trunk: String,
        tip: Oid,
    ) -> impl Future<Output = Option<(Oid, Timestamp)>> + Send;

    /// The `origin` remote's URL.
    fn origin(&self, repo: PathBuf) -> impl Future<Output = Option<String>> + Send;

    /// When a file last changed.
    fn modified(&self, path: PathBuf) -> impl Future<Output = Option<Timestamp>> + Send;
}

/// The real backend: the first `git` that exists.
#[derive(Clone, Debug)]
pub struct GitCli {
    programs: Vec<PathBuf>,
}

impl GitCli {
    /// Runs the first of `programs` that exists (a bare name is looked up on `PATH`).
    pub fn new(programs: Vec<PathBuf>) -> Self {
        Self { programs }
    }

    /// Where `git` usually is, after `PATH`, for a user's home directory.
    pub fn default_programs(home: &Path) -> Vec<PathBuf> {
        let mut programs = vec![PathBuf::from("git")];
        if let Some(user) = home.file_name() {
            programs.push(
                Path::new("/etc/profiles/per-user")
                    .join(user)
                    .join("bin/git"),
            );
        }
        programs.extend([
            home.join(".nix-profile/bin/git"),
            PathBuf::from("/run/current-system/sw/bin/git"),
            PathBuf::from("/opt/homebrew/bin/git"),
            PathBuf::from("/usr/local/bin/git"),
            PathBuf::from("/usr/bin/git"),
        ]);
        programs
    }

    /// Runs git with `args` (and `stdin`, if any) and returns its stdout.
    async fn run(&self, args: &[&str], stdin: Option<String>) -> Result<Vec<u8>, GitError> {
        for program in &self.programs {
            let mut command = Command::new(program);
            command
                .args(args)
                .stdin(if stdin.is_some() {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                // Never take a lock another git is waiting for, never prompt,
                // and never follow a repository from the environment.
                .env("GIT_OPTIONAL_LOCKS", "0")
                .env("GIT_TERMINAL_PROMPT", "0")
                .env_remove("GIT_DIR")
                .env_remove("GIT_WORK_TREE")
                .env_remove("GIT_INDEX_FILE")
                .env_remove("GIT_COMMON_DIR")
                .kill_on_drop(true);
            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(GitError::Failed(error.to_string())),
            };
            if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
                pipe.write_all(input.as_bytes())
                    .await
                    .map_err(|error| GitError::Failed(error.to_string()))?;
            }
            let output = tokio::time::timeout(CALL_TIMEOUT, child.wait_with_output())
                .await
                .map_err(|_elapsed| GitError::Failed(String::from("timed out")))?
                .map_err(|error| GitError::Failed(error.to_string()))?;
            if !output.status.success() {
                let reason = String::from_utf8_lossy(&output.stderr);
                let reason = reason.lines().next().unwrap_or("").trim().to_owned();
                return Err(GitError::Failed(format!(
                    "exit {}: {reason}",
                    output.status
                )));
            }
            return Ok(output.stdout);
        }
        Err(GitError::NotFound)
    }
}

fn git_dir(repo: &Path) -> String {
    format!("--git-dir={}", repo.display())
}

impl GitBackend for GitCli {
    async fn discover(&self, cwd: PathBuf) -> Option<Discovered> {
        let cwd = cwd.to_string_lossy().into_owned();
        let output = self
            .run(
                &[
                    "-C",
                    &cwd,
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-common-dir",
                ],
                None,
            )
            .await
            .ok()?;
        let text = String::from_utf8(output).ok()?;
        let dir = PathBuf::from(text.lines().next()?.trim());
        let common_dir = tokio::fs::canonicalize(&dir).await.unwrap_or(dir);
        Some(Discovered { common_dir })
    }

    async fn refs(&self, repo: PathBuf) -> Result<Vec<RefRow>, GitError> {
        let output = self
            .run(
                &[
                    &git_dir(&repo),
                    "for-each-ref",
                    parse::REF_FORMAT,
                    "refs/heads",
                    "refs/remotes/origin",
                ],
                None,
            )
            .await?;
        Ok(parse::refs(&output))
    }

    async fn ahead_behind(
        &self,
        repo: PathBuf,
        trunk: String,
        refs: Vec<String>,
    ) -> Result<BTreeMap<String, (u32, u32)>, GitError> {
        if refs.is_empty() {
            return Ok(BTreeMap::new());
        }
        let git_dir = git_dir(&repo);
        let format = format!("--format=%(refname)%00%(ahead-behind:{trunk})");
        let mut args = vec![git_dir.as_str(), "for-each-ref", format.as_str()];
        args.extend(refs.iter().map(String::as_str));
        match self.run(&args, None).await {
            Ok(output) => Ok(parse::ahead_behind(&output)),
            Err(GitError::NotFound) => Err(GitError::NotFound),
            // git older than 2.41 has no `ahead-behind` atom: count each ref.
            Err(GitError::Failed(_)) => {
                let mut counts = BTreeMap::new();
                for name in refs {
                    let range = format!("{trunk}...{name}");
                    let output = self
                        .run(
                            &[&git_dir, "rev-list", "--left-right", "--count", &range],
                            None,
                        )
                        .await?;
                    if let Some((behind, ahead)) = parse::left_right(&output) {
                        counts.insert(name, (ahead, behind));
                    }
                }
                Ok(counts)
            }
        }
    }

    async fn trunk_log(
        &self,
        repo: PathBuf,
        trunk: String,
        max: usize,
    ) -> Result<Vec<RawCommit>, GitError> {
        let max = format!("-n{max}");
        let output = self
            .run(
                &[
                    &git_dir(&repo),
                    "log",
                    "--first-parent",
                    &max,
                    parse::COMMIT_FORMAT,
                    &trunk,
                    "--",
                ],
                None,
            )
            .await?;
        Ok(parse::commits(&output))
    }

    async fn lane_log(
        &self,
        repo: PathBuf,
        trunk: String,
        tips: Vec<Oid>,
        max: usize,
    ) -> Result<Vec<LogLine>, GitError> {
        if tips.is_empty() {
            return Ok(Vec::new());
        }
        let mut stdin: String = tips.iter().map(|tip| format!("{tip}\n")).collect();
        stdin.push_str(&format!("^{trunk}\n"));
        let max = format!("-n{max}");
        let output = self
            .run(
                &[
                    &git_dir(&repo),
                    "log",
                    "--stdin",
                    "--boundary",
                    "--topo-order",
                    &max,
                    parse::LOG_FORMAT,
                ],
                Some(stdin),
            )
            .await?;
        Ok(parse::log_lines(&output))
    }

    async fn merge_base(&self, repo: PathBuf, trunk: String, tip: Oid) -> Option<(Oid, Timestamp)> {
        let git_dir = git_dir(&repo);
        let output = self
            .run(&[&git_dir, "merge-base", &trunk, tip.as_str()], None)
            .await
            .ok()?;
        let base = Oid::parse(std::str::from_utf8(&output).ok()?)?;
        let output = self
            .run(
                &[&git_dir, "show", "-s", "--format=%ct", base.as_str()],
                None,
            )
            .await
            .ok()?;
        let at = parse::unix(std::str::from_utf8(&output).ok()?.trim())?;
        Some((base, at))
    }

    async fn origin(&self, repo: PathBuf) -> Option<String> {
        let output = self
            .run(&[&git_dir(&repo), "remote", "get-url", "origin"], None)
            .await
            .ok()?;
        Some(String::from_utf8(output).ok()?.trim().to_owned())
    }

    async fn modified(&self, path: PathBuf) -> Option<Timestamp> {
        let metadata = tokio::fs::metadata(path).await.ok()?;
        Some(metadata.modified().ok()?.into())
    }
}
