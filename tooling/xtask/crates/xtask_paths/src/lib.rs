#![deny(missing_docs)]
//! Shared path discovery for the xtask command crates.
//!
//! Every xtask command needs to locate the repository Cargo workspace root (to
//! anchor `cargo metadata`, read member manifests, spawn `wasm-pack`, …) and
//! the repository root (where `docker/`, `infra/`, `apps/`, and the root
//! `justfile` live). The root is discovered at runtime by walking ancestors of
//! the invocation directory, with the running executable's directory as a
//! fallback, so cached xtask artifacts never retain a stale checkout path.

use std::fmt;
use std::path::{Path, PathBuf};

/// The repository Cargo workspace root.
///
/// Commands can run from any directory inside the repository. Packaged xtask
/// binaries can set `MACRO_REPO_ROOT` when they run against a staged copy or
/// from outside the repository.
pub fn workspace_root() -> PathBuf {
    repo_root_override()
        .or_else(discover_repo_root)
        .unwrap_or_else(|| {
            panic!(
                "could not discover the repository root from the current directory or executable path; set MACRO_REPO_ROOT"
            )
        })
}

fn discover_repo_root() -> Option<PathBuf> {
    std::env::current_dir()
        .ok()
        .and_then(|current_dir| find_repo_root_from(&current_dir))
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|executable| executable.parent().and_then(find_repo_root_from))
        })
}

fn find_repo_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|candidate| is_repo_root(candidate))
        .map(Path::to_owned)
}

fn is_repo_root(candidate: &Path) -> bool {
    candidate.join("Cargo.toml").is_file() && candidate.join("tooling/xtask/Cargo.toml").is_file()
}

/// The repository root, which is also the Cargo workspace root.
pub fn repo_root() -> PathBuf {
    workspace_root()
}

/// Read the runtime repository root used by packaged xtask binaries.
///
/// Environment variables are appropriate here because this tooling crate runs
/// both inside and outside the service runtime, including in the preview VM.
#[allow(clippy::disallowed_methods)]
fn repo_root_override() -> Option<PathBuf> {
    std::env::var_os("MACRO_REPO_ROOT").map(PathBuf::from)
}

/// A UTF-8, repository-relative path that must resolve to a regular file.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RepoFile<'a>(&'a str);

impl<'a> RepoFile<'a> {
    /// Construct a repository file reference.
    ///
    /// This is `const` so [`repo_file!`] can reject malformed literals during
    /// compilation. Filesystem existence is checked separately by
    /// [`RepoFile::validate_at`].
    pub const fn new(path: &'a str) -> Self {
        assert_repo_path_syntax(path, false);
        Self(path)
    }

    /// Parse a dynamically supplied repository file reference.
    pub fn try_new(path: &'a str) -> Result<Self, RepoPathError> {
        validate_repo_path_syntax("repository file", path, false)?;
        Ok(Self(path))
    }

    /// Return the repository-relative path string.
    pub const fn as_str(self) -> &'a str {
        self.0
    }

    /// Require this path to be a file below `root`.
    pub fn validate_at(self, root: &Path) -> Result<(), RepoPathError> {
        let resolved = root.join(self.0);
        if resolved.is_file() {
            Ok(())
        } else {
            Err(RepoPathError::new(format!(
                "repository file `{}` does not exist at {}",
                self.0,
                resolved.display()
            )))
        }
    }
}

/// A UTF-8, repository-relative path that must resolve to a directory.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RepoDir<'a>(&'a str);

impl<'a> RepoDir<'a> {
    /// Construct a repository directory reference.
    pub const fn new(path: &'a str) -> Self {
        assert_repo_path_syntax(path, false);
        Self(path)
    }

    /// Parse a dynamically supplied repository directory reference.
    pub fn try_new(path: &'a str) -> Result<Self, RepoPathError> {
        validate_repo_path_syntax("repository directory", path, false)?;
        Ok(Self(path))
    }

    /// Return the repository-relative path string.
    pub const fn as_str(self) -> &'a str {
        self.0
    }

    /// Require this path to be a directory below `root`.
    pub fn validate_at(self, root: &Path) -> Result<(), RepoPathError> {
        let resolved = root.join(self.0);
        if resolved.is_dir() {
            Ok(())
        } else {
            Err(RepoPathError::new(format!(
                "repository directory `{}` does not exist at {}",
                self.0,
                resolved.display()
            )))
        }
    }
}

/// A positive GitHub-style path filter that must match the repository.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RepoGlob<'a>(&'a str);

impl<'a> RepoGlob<'a> {
    /// Construct a repository glob reference.
    pub const fn new(pattern: &'a str) -> Self {
        assert_repo_path_syntax(pattern, true);
        Self(pattern)
    }

    /// Parse a dynamically supplied repository glob reference.
    pub fn try_new(pattern: &'a str) -> Result<Self, RepoPathError> {
        validate_repo_path_syntax("repository glob", pattern, true)?;
        Ok(Self(pattern))
    }

    /// Return the repository-relative glob string.
    pub const fn as_str(self) -> &'a str {
        self.0
    }

    /// Require this glob to match at least one path below `root`.
    ///
    /// Workflow path filters currently use the shared `*`, `?`, `[]`, and
    /// `**` subset understood by both GitHub Actions and the `glob` crate.
    pub fn validate_at(self, root: &Path) -> Result<(), RepoPathError> {
        // GitHub treats a terminal `/**` as all descendants. `glob` requires
        // a following component to yield files, so translate it to `/**/*`
        // for the existence check without changing the rendered workflow.
        let filesystem_pattern = self
            .0
            .strip_suffix("/**")
            .map(|prefix| format!("{prefix}/**/*"));
        let absolute = root.join(filesystem_pattern.as_deref().unwrap_or(self.0));
        let pattern = absolute.to_str().ok_or_else(|| {
            RepoPathError::new(format!(
                "repository root produced a non-UTF-8 glob for `{}`",
                self.0
            ))
        })?;
        let mut entries = glob::glob(pattern).map_err(|error| {
            RepoPathError::new(format!("invalid repository glob `{}`: {error}", self.0))
        })?;

        match entries.next() {
            Some(Ok(_)) => return Ok(()),
            Some(Err(error)) => {
                return Err(RepoPathError::new(format!(
                    "failed while evaluating repository glob `{}`: {error}",
                    self.0
                )));
            }
            None => {}
        }

        Err(RepoPathError::new(format!(
            "repository glob `{}` matches no paths below {}",
            self.0,
            root.display()
        )))
    }
}

/// A path created or consumed at workflow runtime rather than in the checkout.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct RuntimePath<'a>(&'a str);

impl<'a> RuntimePath<'a> {
    /// Construct a non-empty workflow-runtime path.
    pub const fn new(path: &'a str) -> Self {
        assert!(!path.is_empty(), "runtime path must not be empty");
        Self(path)
    }

    /// Return the runtime path string.
    pub const fn as_str(self) -> &'a str {
        self.0
    }
}

macro_rules! impl_path_string_conversions {
    ($type:ident) => {
        impl fmt::Display for $type<'_> {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.0)
            }
        }

        impl AsRef<str> for $type<'_> {
            fn as_ref(&self) -> &str {
                self.0
            }
        }

        impl From<$type<'_>> for String {
            fn from(path: $type<'_>) -> Self {
                path.0.to_owned()
            }
        }
    };
}

impl_path_string_conversions!(RepoFile);
impl_path_string_conversions!(RepoDir);
impl_path_string_conversions!(RepoGlob);
impl_path_string_conversions!(RuntimePath);

/// An invalid or unresolved typed repository path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepoPathError {
    message: String,
}

impl RepoPathError {
    fn new(message: String) -> Self {
        Self { message }
    }
}

impl fmt::Display for RepoPathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RepoPathError {}

const fn assert_repo_path_syntax(path: &str, allow_glob: bool) {
    if repo_path_syntax_error(path, allow_glob).is_some() {
        panic!("invalid repository-relative path literal");
    }
}

fn validate_repo_path_syntax(
    kind: &str,
    path: &str,
    allow_glob: bool,
) -> Result<(), RepoPathError> {
    if let Some(reason) = repo_path_syntax_error(path, allow_glob) {
        Err(RepoPathError::new(format!(
            "invalid {kind} `{path}`: {reason}"
        )))
    } else {
        Ok(())
    }
}

const fn repo_path_syntax_error(path: &str, allow_glob: bool) -> Option<&'static str> {
    let bytes = path.as_bytes();
    if bytes.is_empty() {
        return Some("path is empty");
    }
    if bytes[0] == b'/' || bytes[0] == b'\\' {
        return Some("path must be relative to the repository root");
    }

    let mut index = 0;
    let mut component_start = 0;
    while index <= bytes.len() {
        let at_end = index == bytes.len();
        if !at_end && bytes[index] == b'\\' {
            return Some("path must use forward slashes");
        }
        if at_end || bytes[index] == b'/' {
            let component_len = index - component_start;
            if component_len == 0 {
                return Some("path contains an empty component");
            }
            if component_len == 1 && bytes[component_start] == b'.' {
                return Some("path contains a current-directory component");
            }
            if component_len == 2
                && bytes[component_start] == b'.'
                && bytes[component_start + 1] == b'.'
            {
                return Some("path escapes the repository root");
            }
            component_start = index + 1;
        } else if !allow_glob && is_glob_meta(bytes[index]) {
            return Some("file and directory paths must not contain glob metacharacters");
        }
        index += 1;
    }
    None
}

const fn is_glob_meta(byte: u8) -> bool {
    matches!(byte, b'*' | b'?' | b'[' | b']' | b'{' | b'}' | b'!')
}

/// Construct a compile-time checked [`RepoFile`] literal.
#[macro_export]
macro_rules! repo_file {
    ($path:literal) => {{
        const PATH: $crate::RepoFile<'static> = $crate::RepoFile::new($path);
        PATH
    }};
}

/// Construct a compile-time checked [`RepoDir`] literal.
#[macro_export]
macro_rules! repo_dir {
    ($path:literal) => {{
        const PATH: $crate::RepoDir<'static> = $crate::RepoDir::new($path);
        PATH
    }};
}

/// Construct a compile-time checked [`RepoGlob`] literal.
#[macro_export]
macro_rules! repo_glob {
    ($path:literal) => {{
        const PATH: $crate::RepoGlob<'static> = $crate::RepoGlob::new($path);
        PATH
    }};
}

/// Construct a compile-time checked, non-empty [`RuntimePath`] literal.
#[macro_export]
macro_rules! runtime_path {
    ($path:literal) => {{
        const PATH: $crate::RuntimePath<'static> = $crate::RuntimePath::new($path);
        PATH
    }};
}

#[cfg(test)]
mod test;
