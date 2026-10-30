//! Finding executables on `PATH`.
//!
//! On Unix `Command::new("npm")` searches `PATH` itself. On Windows it only
//! tries `npm.exe`, while npm, npx and every npm package bin are `.cmd`
//! shims, so every spawn of a bare command name goes through [`launchable`].

use std::ffi::OsString;
use std::path::{Path, PathBuf};

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Path;
    }
}

/// The directories on this process's `PATH`, in search order.
pub fn search_paths() -> Vec<PathBuf> {
    environment::Path::new()
        .and_then(|path| path.value().map(OsString::from))
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default()
}

/// The first `command` in `paths`, trying the Windows launcher extensions.
pub fn find(paths: &[PathBuf], command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = [
        command.to_owned(),
        format!("{command}.exe"),
        format!("{command}.cmd"),
        format!("{command}.bat"),
    ];
    #[cfg(not(windows))]
    let names = [command.to_owned()];

    paths
        .iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|candidate| is_executable(candidate))
}

/// The program to hand `Command::new` for `command`: on Windows a bare name is
/// resolved to its full path, extension included. A name that is not found is
/// passed through, so the spawn reports it missing.
pub fn launchable(command: &Path) -> OsString {
    #[cfg(windows)]
    if command.components().count() == 1
        && command.extension().is_none()
        && let Some(found) = command
            .to_str()
            .and_then(|name| find(&search_paths(), name))
    {
        return found.into_os_string();
    }
    command.into()
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}
