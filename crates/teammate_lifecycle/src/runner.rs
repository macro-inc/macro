//! A boot's effects: read the state and settings, clone and configure the
//! workspace, gather the facts [`crate::boot`] decides from, and carry out
//! its plan. Git, the file system and the runtime are ports; git and the
//! runtime stay external programs.

use std::io;
use std::path::{Path, PathBuf};

use crate::boot::{
    self, BootExit, BootInput, BootState, BootStep, CodeFacts, CommitId, Garbled, RollbackReason,
};
use crate::exit::PreviousExit;

pub mod git;
pub mod local;
pub mod package;
pub mod process;
pub mod settings;

use git::{ConfigKey, Git, GitCommand, GitError, RepositoryFile};

#[cfg(test)]
mod test;

/// The most bytes read from a file the boot reads: a package.json, a
/// bun.lock, `agent.env` or a state file.
pub const MAX_FILE: u64 = 32 * 1024 * 1024;

/// The file system, as a boot uses it. Reads are bounded by [`MAX_FILE`].
pub trait Fs {
    /// A file's contents, `None` when it doesn't exist.
    fn read(&self, path: &Path) -> io::Result<Option<Vec<u8>>>;
    /// Replace a file whole (a sibling, then a rename).
    fn write(&self, path: &Path, contents: &[u8]) -> io::Result<()>;
    /// Whether anything is at `path`, a dangling link included.
    fn exists(&self, path: &Path) -> io::Result<bool>;
    /// A link's target, `None` when `path` isn't a link.
    fn read_link(&self, path: &Path) -> io::Result<Option<PathBuf>>;
    /// Remove whatever is at `path`, if anything.
    fn remove(&self, path: &Path) -> io::Result<()>;
    /// Make `link` a symbolic link to `target`.
    fn symlink(&self, target: &Path, link: &Path) -> io::Result<()>;
    /// Create a directory and its parents.
    fn create_directories(&self, path: &Path) -> io::Result<()>;
    /// Rename `from` to `to`.
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
}

/// The runtime the boot hands over to.
pub trait Runtime {
    /// Replace this process with `bun <workspace>/cli.ts run`, in the
    /// workspace. Returns only on failure.
    fn exec(&self, workspace: &Path) -> io::Error;
}

/// Where a boot works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootPaths {
    /// The repository clone.
    pub workspace: PathBuf,
    /// `last-good`, which the runtime writes after a healthy boot.
    pub last_good: PathBuf,
    /// `failed-boots`.
    pub failed_boots: PathBuf,
    /// `boot-head`.
    pub boot_head: PathBuf,
    /// The image's runtime: its `bun.lock` and `node_modules`.
    pub runtime: PathBuf,
    /// `agent.env` (`MUPPET_CREDENTIALS_FILE`).
    pub credentials: PathBuf,
}

/// How a boot ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootOutcome {
    /// Start the runtime on this head.
    Run {
        /// The head it runs.
        head: CommitId,
    },
    /// Exit without starting it.
    Exit(BootExit),
}

/// A boot step that failed. The boot exits 1, a crash: counted against the
/// boot head, like any failed boot.
#[derive(Debug, thiserror::Error)]
pub enum BootError {
    /// A git command failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// A file couldn't be read or written.
    #[error("{path}: {source}")]
    File {
        /// Which.
        path: PathBuf,
        /// How.
        #[source]
        source: io::Error,
    },
    /// git printed something that isn't a commit id.
    #[error("git printed no commit id")]
    NoCommit,
}

fn file_error(path: &Path) -> impl FnOnce(io::Error) -> BootError + '_ {
    move |source| BootError::File {
        path: path.to_owned(),
        source,
    }
}

/// One boot, up to the hand-over to the runtime.
pub struct Boot<'paths, GitImpl, FsImpl> {
    /// git, on the workspace.
    pub git: GitImpl,
    /// The file system.
    pub fs: FsImpl,
    /// Where it works.
    pub paths: &'paths BootPaths,
}

impl<GitImpl: Git, FsImpl: Fs> Boot<'_, GitImpl, FsImpl> {
    /// Count the previous run, admit this start, prepare the workspace and
    /// carry out the plan.
    pub async fn run(&self, previous: PreviousExit) -> Result<BootOutcome, BootError> {
        let paths = self.paths;
        let state = self.state()?;
        let failed_boots = boot::count_previous(&state, previous);
        self.write_line(&paths.failed_boots, &failed_boots.to_string())?;

        let settings = match self.fs.read(&paths.credentials) {
            Ok(Some(contents)) => settings::settings(&String::from_utf8_lossy(&contents)),
            Ok(None) | Err(_) => Err(boot::SettingsProblem::Unreadable),
        };
        let admitted = boot::admit(
            &state,
            previous,
            &settings.as_ref().map(|_| ()).map_err(Clone::clone),
        );
        let settings = match (admitted, settings) {
            (Err(end), _) => return Ok(BootOutcome::Exit(end)),
            (Ok(()), Err(problem)) => {
                return Ok(BootOutcome::Exit(BootExit::InvalidSetting(problem)));
            }
            (Ok(()), Ok(settings)) => settings,
        };

        self.prepare_workspace(&settings).await?;
        let head = self.head().await?;
        let input = BootInput {
            failed_boots,
            head: head.clone(),
            head_code: self.head_code().await?,
            last_good: match state.last_good {
                Some(good) if good != head => {
                    let code = self.commit_code(&good).await?;
                    Some((good, code))
                }
                Some(_) | None => None,
            },
            image_level: self.image_level()?,
        };
        let plan = boot::plan_boot(&input);
        for step in &plan.steps {
            self.carry_out(step).await?;
        }
        match plan.end {
            Ok(()) => Ok(BootOutcome::Run {
                head: self.head().await?,
            }),
            Err(end) => Ok(BootOutcome::Exit(end)),
        }
    }

    fn state(&self) -> Result<BootState, BootError> {
        let paths = self.paths;
        let line = |path: &Path| -> Result<Option<String>, BootError> {
            let contents = self.fs.read(path).map_err(file_error(path))?;
            Ok(contents.map(|contents| String::from_utf8_lossy(&contents).trim().to_owned()))
        };
        // A count that doesn't read is 0, as `$(cat … || echo 0)` was.
        let failed_boots = line(&paths.failed_boots)?
            .and_then(|count| count.parse().ok())
            .unwrap_or(0);
        Ok(BootState {
            failed_boots,
            boot_head: line(&paths.boot_head)?.and_then(|head| CommitId::new(head).ok()),
            last_good: line(&paths.last_good)?.and_then(|good| CommitId::new(good).ok()),
        })
    }

    /// Clone on the first start (into a sibling, so a failed clone never
    /// poisons the next), then follow a re-enrollment's URL and identity.
    async fn prepare_workspace(&self, settings: &settings::Settings) -> Result<(), BootError> {
        let workspace = &self.paths.workspace;
        let present = self.fs.exists(workspace).map_err(file_error(workspace))?;
        if !present {
            let staging = PathBuf::from(format!(
                "{}.clone.{}",
                workspace.display(),
                std::process::id()
            ));
            if let Some(parent) = workspace.parent() {
                self.fs
                    .create_directories(parent)
                    .map_err(file_error(parent))?;
            }
            self.fs.remove(&staging).map_err(file_error(&staging))?;
            let cloned = self
                .git
                .run(GitCommand::Clone {
                    url: settings.repo_url.clone(),
                    into: staging.clone(),
                })
                .await;
            if let Err(error) = cloned {
                let _ = self.fs.remove(&staging);
                return Err(error.into());
            }
            self.fs
                .rename(&staging, workspace)
                .map_err(file_error(workspace))?;
        }

        let commands = [
            GitCommand::SetOrigin {
                url: settings.repo_url.clone(),
            },
            GitCommand::ResetCredentialHelpers,
            GitCommand::AddCredentialHelper,
            GitCommand::SetConfig {
                key: ConfigKey::UseHttpPath,
                value: "true".to_owned(),
            },
            GitCommand::SetConfig {
                key: ConfigKey::UserName,
                value: settings.name.clone(),
            },
            GitCommand::SetConfig {
                key: ConfigKey::UserEmail,
                value: settings.email.clone(),
            },
        ];
        for command in commands {
            self.git.run(command).await?;
        }
        Ok(())
    }

    async fn head(&self) -> Result<CommitId, BootError> {
        let output = self.git.run(GitCommand::Head).await?;
        commit_of(&output)
    }

    /// The checked-out code: uncommitted changes count.
    async fn head_code(&self) -> Result<CodeFacts, BootError> {
        let workspace = &self.paths.workspace;
        let package_path = workspace.join("package.json");
        let package_json = self
            .fs
            .read(&package_path)
            .map_err(file_error(&package_path))?;
        let lock_path = workspace.join("bun.lock");
        let lock = self.fs.read(&lock_path).map_err(file_error(&lock_path))?;
        Ok(CodeFacts {
            needs: package_json.as_deref().map_or(Ok(0), |contents| {
                package::level(contents, package::NEEDS_FIELD)
            }),
            lock_matches_image: self.matches_image_lock(lock.as_deref())?,
            dependencies_edited: package::dependencies_differ(
                package_json.as_deref(),
                self.template_package_json().await.as_deref(),
            ),
        })
    }

    /// A commit's code, as a rollback would check it out.
    async fn commit_code(&self, commit: &CommitId) -> Result<CodeFacts, BootError> {
        let package_json = self.show(commit, RepositoryFile::PackageJson).await;
        let lock = self.show(commit, RepositoryFile::BunLock).await;
        Ok(CodeFacts {
            // Unreadable at that commit: it won't run here.
            needs: package_json.as_deref().map_or(Err(Garbled), |contents| {
                package::level(contents, package::NEEDS_FIELD)
            }),
            lock_matches_image: self.matches_image_lock(lock.as_deref())?,
            dependencies_edited: package::dependencies_differ(
                package_json.as_deref(),
                self.template_package_json().await.as_deref(),
            ),
        })
    }

    /// The template's package.json: the repository's first commit's.
    async fn template_package_json(&self) -> Option<Vec<u8>> {
        let roots = self.git.run(GitCommand::RootCommits).await.ok()?;
        let template = String::from_utf8_lossy(&roots)
            .lines()
            .last()
            .and_then(|line| CommitId::new(line.trim()).ok())?;
        self.show(&template, RepositoryFile::PackageJson).await
    }

    async fn show(&self, commit: &CommitId, path: RepositoryFile) -> Option<Vec<u8>> {
        self.git
            .run(GitCommand::Show {
                commit: commit.clone(),
                path,
            })
            .await
            .ok()
    }

    fn matches_image_lock(&self, lock: Option<&[u8]>) -> Result<bool, BootError> {
        let image_lock_path = self.paths.runtime.join("bun.lock");
        let image_lock = self
            .fs
            .read(&image_lock_path)
            .map_err(file_error(&image_lock_path))?;
        Ok(matches!((lock, image_lock), (Some(lock), Some(image_lock)) if lock == image_lock))
    }

    /// The image's muppet API level; 0 without a package.json.
    fn image_level(&self) -> Result<Result<u64, Garbled>, BootError> {
        let path = self
            .paths
            .runtime
            .join("node_modules/@macro-inc/muppet/package.json");
        let contents = self.fs.read(&path).map_err(file_error(&path))?;
        Ok(contents.as_deref().map_or(Ok(0), |contents| {
            package::level(contents, package::HAS_FIELD)
        }))
    }

    async fn carry_out(&self, step: &BootStep) -> Result<(), BootError> {
        let paths = self.paths;
        match step {
            BootStep::RollBack { to, reason } => {
                let head = self.head().await?;
                let message = match reason {
                    RollbackReason::FailedBoots { count } => {
                        tracing::warn!(from = %head, to = %to, failed_boots = count, "rolling back to last-good after failed boots");
                        format!(
                            "revert(agent): roll back to last-good {} after {count} failed boots",
                            to.short()
                        )
                    }
                    RollbackReason::DependenciesChanged => {
                        tracing::warn!(from = %head, to = %to, "rolling back to last-good: the code changed its dependencies");
                        format!(
                            "revert(agent): roll back to last-good {}: its dependencies changed, and new packages need a new image",
                            to.short()
                        )
                    }
                    RollbackReason::NeedsNewerImage { needs, has } => {
                        tracing::warn!(from = %head, to = %to, needs, has, "rolling back to last-good: the code needs a newer image");
                        format!(
                            "revert(agent): roll back to last-good {}: its code needs muppet API {needs}, the image has {has}",
                            to.short()
                        )
                    }
                };
                let output = self
                    .git
                    .run(GitCommand::CommitTree {
                        tree_of: to.clone(),
                        parent: head,
                        message,
                    })
                    .await?;
                let rollback = commit_of(&output)?;
                self.git
                    .run(GitCommand::ResetHard {
                        commit: rollback.clone(),
                    })
                    .await?;
                // Last-good's tree, so it is last-good: a boot of it that
                // dies early is never counted toward rolling back from it.
                self.write_line(&paths.last_good, rollback.as_str())?;
                self.write_line(&paths.failed_boots, "0")?;
            }
            BootStep::RecordBootHead => {
                let head = self.head().await?;
                self.write_line(&paths.boot_head, head.as_str())?;
            }
            BootStep::AdoptLock => {
                tracing::info!("adopting the image's bun.lock");
                let image_lock_path = paths.runtime.join("bun.lock");
                let image_lock = self
                    .fs
                    .read(&image_lock_path)
                    .map_err(file_error(&image_lock_path))?
                    .unwrap_or_default();
                let lock_path = paths.workspace.join("bun.lock");
                self.fs
                    .write(&lock_path, &image_lock)
                    .map_err(file_error(&lock_path))?;
                self.git
                    .run(GitCommand::CommitLock {
                        message: "chore(agent): adopt the image's bun.lock".to_owned(),
                    })
                    .await?;
            }
            BootStep::LinkModules => {
                let modules = paths.workspace.join("node_modules");
                let target = paths.runtime.join("node_modules");
                let current = self.fs.read_link(&modules).map_err(file_error(&modules))?;
                if current.as_deref() != Some(target.as_path()) {
                    self.fs.remove(&modules).map_err(file_error(&modules))?;
                    self.fs
                        .symlink(&target, &modules)
                        .map_err(file_error(&modules))?;
                }
            }
        }
        Ok(())
    }

    fn write_line(&self, path: &Path, line: &str) -> Result<(), BootError> {
        self.fs
            .write(path, format!("{line}\n").as_bytes())
            .map_err(file_error(path))
    }
}

fn commit_of(output: &[u8]) -> Result<CommitId, BootError> {
    CommitId::new(String::from_utf8_lossy(output).trim()).map_err(|_| BootError::NoCommit)
}
