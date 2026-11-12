//! The Windows install layout: a launcher and the versions it starts.
//!
//! Windows cannot replace a running executable or `exec` into a new one, so
//! the installed `macrod.exe` (the one on `PATH`) is a launcher. It runs the
//! newest `versions\<tag>\macrod-core.exe` with its own arguments and console,
//! waits, and exits with the core's exit code. An update is staged as a new
//! version folder and used from the next launch; the launcher prunes older
//! folders once the newest has started. The launcher is the same binary as
//! the core: which one it is follows from its file name and the `versions`
//! folder beside it.
//!
//! The layout logic is platform-neutral so it is tested everywhere; only the
//! process handling in [`run_as_launcher`] is Windows-only.

use std::path::{Path, PathBuf};

use super::release::ReleaseVersion;

#[cfg(test)]
mod test;

/// The folder of installed versions, beside the launcher.
pub const VERSIONS_DIRECTORY: &str = "versions";

/// The core binary's name inside each version folder.
pub const CORE_EXECUTABLE: &str = "macrod-core.exe";

/// A version folder still being written; never launched.
const PARTIAL_SUFFIX: &str = ".partial";

/// The `versions` folder of one installation.
#[derive(Debug, Clone)]
pub struct Versions {
    directory: PathBuf,
}

impl Versions {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    /// The installation a core binary at `executable` belongs to: its
    /// `versions\<tag>\` parent, or (a plain `macrod.exe` with no layout yet)
    /// a `versions` folder beside it, which turns that `macrod.exe` into the
    /// launcher from its next start.
    pub fn of_executable(executable: &Path) -> Self {
        let folder = executable.parent().unwrap_or(Path::new("."));
        match folder.parent() {
            Some(versions)
                if versions
                    .file_name()
                    .is_some_and(|name| name == VERSIONS_DIRECTORY)
                    && executable
                        .file_name()
                        .is_some_and(|name| name == CORE_EXECUTABLE) =>
            {
                Self::new(versions.to_owned())
            }
            _ => Self::new(folder.join(VERSIONS_DIRECTORY)),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Where a version's core is written before it is committed.
    pub fn staging_executable(&self, tag: &str) -> PathBuf {
        self.directory
            .join(format!("{tag}{PARTIAL_SUFFIX}"))
            .join(CORE_EXECUTABLE)
    }

    /// Make a staged version launchable. Replaces an earlier copy of the
    /// same version.
    pub fn commit(&self, tag: &str) -> std::io::Result<PathBuf> {
        let staged = self.directory.join(format!("{tag}{PARTIAL_SUFFIX}"));
        let committed = self.directory.join(tag);
        if committed.exists() {
            std::fs::remove_dir_all(&committed)?;
        }
        std::fs::rename(&staged, &committed)?;
        Ok(committed.join(CORE_EXECUTABLE))
    }

    /// The newest complete version and its core binary.
    pub fn newest(&self) -> Option<(ReleaseVersion, PathBuf)> {
        std::fs::read_dir(&self.directory)
            .ok()?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                let version = ReleaseVersion::parse(name.to_str()?)?;
                let core = entry.path().join(CORE_EXECUTABLE);
                core.is_file().then_some((version, core))
            })
            .max_by_key(|(version, _)| *version)
    }

    /// Remove every complete version folder but `keep`. Partial folders
    /// stay: a running macrod may be staging one, and an abandoned one is
    /// never launched and is overwritten when that version is staged again.
    /// Best effort: a version another macrod is still running from cannot be
    /// removed on Windows, and stays until a later launch.
    pub fn prune(&self, keep: ReleaseVersion) {
        let Ok(entries) = std::fs::read_dir(&self.directory) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let stale = ReleaseVersion::parse(name).is_some_and(|version| version != keep);
            if stale && let Err(error) = std::fs::remove_dir_all(entry.path()) {
                tracing::debug!(error = %error, folder = name, "could not prune an old macrod version");
            }
        }
    }
}

/// Run as the launcher when this binary is the installed `macrod.exe` with a
/// `versions` folder beside it. Returns the core's exit code, or `None` when
/// this process is not a launcher (and should run macrod itself).
#[cfg(windows)]
pub fn run_as_launcher() -> Option<i32> {
    let executable = std::env::current_exe().ok()?;
    if !executable
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("macrod.exe"))
    {
        return None;
    }
    let versions = Versions::new(executable.parent()?.join(VERSIONS_DIRECTORY));
    let (version, core) = versions.newest()?;

    // Ctrl+C reaches every process on the console. The core decides what it
    // means; the launcher keeps waiting so the shell gets the core's exit code.
    // SAFETY: a null handler with TRUE only sets this process to ignore Ctrl+C.
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 1);
    }
    let mut child = match std::process::Command::new(&core)
        .args(std::env::args_os().skip(1))
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("macrod: could not start {}: {error}", core.display());
            return Some(1);
        }
    };
    versions.prune(version);
    match child.wait() {
        Ok(status) => Some(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("macrod: lost track of {}: {error}", core.display());
            Some(1)
        }
    }
}
