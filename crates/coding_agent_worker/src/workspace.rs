//! Which directory a new session works in, and the local ceiling on it.
//!
//! The web picks a runtime's workspace and each agent's from what this daemon
//! reports: the `allowed_roots` in `macrod.toml` and the repositories directly
//! under them. Every new session resolves its workspace fresh - the agent's,
//! else the runtime's, else the local `workspace.path` - and macrod refuses
//! any directory outside `allowed_roots`, whoever named it. Running sessions
//! keep the workspace they were created with.

use std::path::{Path, PathBuf};

use harnesses::domain::models::{ReportedWorkspace, ReportedWorkspaceKind};

#[cfg(test)]
mod test;

/// Repositories are found at most this far below an allowed root.
const DISCOVERY_DEPTH: u8 = 2;

/// Cap on the workspaces one report carries, roots included.
const MAX_REPORTED_WORKSPACES: usize = 200;

/// Who chose a session's workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum WorkspaceSource {
    /// The agent's workspace, set in its settings on the web.
    Agent,
    /// The runtime's workspace, set on the web.
    Runtime,
    /// `workspace.path` in `macrod.toml`.
    Local,
}

/// The directory a new session should use, before the ceiling is applied:
/// the agent's, else the runtime's, else the local one.
pub fn requested_workspace(
    agent: Option<&str>,
    runtime: Option<&str>,
    local: &Path,
) -> (PathBuf, WorkspaceSource) {
    match (agent, runtime) {
        (Some(agent), _) => (PathBuf::from(agent), WorkspaceSource::Agent),
        (None, Some(runtime)) => (PathBuf::from(runtime), WorkspaceSource::Runtime),
        (None, None) => (local.to_owned(), WorkspaceSource::Local),
    }
}

/// Why a workspace was refused.
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceRefusal {
    /// The directory does not exist or cannot be read.
    #[error("workspace {} does not exist on this machine", path.display())]
    Missing {
        /// The requested directory.
        path: PathBuf,
        /// What resolving it returned.
        #[source]
        source: std::io::Error,
    },
    /// The path names a file, not a directory.
    #[error("workspace {} is not a directory", path.display())]
    NotADirectory {
        /// The requested path.
        path: PathBuf,
    },
    /// The directory, with `..` and symlinks resolved, is outside every
    /// allowed root.
    #[error(
        "workspace {} is outside allowed_roots in macrod.toml ({}); add a root there or pick \
         another workspace in Macro",
        path.display(),
        roots
    )]
    OutsideAllowedRoots {
        /// The requested directory.
        path: PathBuf,
        /// The allowed roots, for the message.
        roots: String,
    },
}

/// The directories sessions may work in, resolved once: each root
/// canonicalized so `..` and symlinks cannot step outside it.
#[derive(Debug, Clone)]
pub struct AllowedRoots {
    roots: Vec<PathBuf>,
}

impl AllowedRoots {
    /// Resolve the configured roots. A root that does not exist can contain
    /// nothing, so it is left out with a warning.
    pub fn resolve(configured: &[PathBuf]) -> Self {
        let roots = configured
            .iter()
            .filter_map(|root| match std::fs::canonicalize(root) {
                Ok(root) if root.is_dir() => Some(root),
                Ok(root) => {
                    tracing::warn!(root = %root.display(), "an allowed root is not a directory; ignored");
                    None
                }
                Err(error) => {
                    tracing::warn!(
                        root = %root.display(),
                        error = %error,
                        "an allowed root could not be resolved; ignored"
                    );
                    None
                }
            })
            .collect();
        Self { roots }
    }

    /// The resolved roots.
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// The canonical directory for `requested`, when it is inside an allowed
    /// root.
    pub fn admit(&self, requested: &Path) -> Result<PathBuf, WorkspaceRefusal> {
        let canonical =
            std::fs::canonicalize(requested).map_err(|source| WorkspaceRefusal::Missing {
                path: requested.to_owned(),
                source,
            })?;
        if !canonical.is_dir() {
            return Err(WorkspaceRefusal::NotADirectory {
                path: requested.to_owned(),
            });
        }
        if self.roots.iter().any(|root| canonical.starts_with(root)) {
            return Ok(canonical);
        }
        Err(WorkspaceRefusal::OutsideAllowedRoots {
            path: requested.to_owned(),
            roots: self
                .roots
                .iter()
                .map(|root| root.display().to_string())
                .collect::<Vec<_>>()
                .join(", "),
        })
    }

    /// What the web may pick from: every root, then the repositories found
    /// within two levels below them. Hidden directories are skipped and
    /// symlinks are not followed; the list is capped.
    pub fn discover(&self) -> Vec<ReportedWorkspace> {
        let mut workspaces: Vec<ReportedWorkspace> = self
            .roots
            .iter()
            .filter_map(|root| reported(root, ReportedWorkspaceKind::AllowedRoot))
            .collect();
        let mut repositories = Vec::new();
        for root in &self.roots {
            find_repositories(root, 0, &mut repositories);
        }
        repositories.sort();
        repositories.dedup();
        workspaces.extend(
            repositories
                .iter()
                .filter_map(|path| reported(path, ReportedWorkspaceKind::Repository)),
        );
        workspaces.truncate(MAX_REPORTED_WORKSPACES);
        workspaces
    }
}

fn reported(path: &Path, kind: ReportedWorkspaceKind) -> Option<ReportedWorkspace> {
    // A path the web cannot carry as text cannot be picked there.
    let path = path.to_str()?.to_owned();
    Some(ReportedWorkspace { path, kind })
}

fn find_repositories(directory: &Path, depth: u8, found: &mut Vec<PathBuf>) {
    if depth >= DISCOVERY_DEPTH || found.len() >= MAX_REPORTED_WORKSPACES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir());
        let hidden = entry.file_name().to_string_lossy().starts_with('.');
        if !is_directory || hidden {
            continue;
        }
        let path = entry.path();
        if path.join(".git").exists() {
            found.push(path);
        } else {
            find_repositories(&path, depth + 1, found);
        }
    }
}
