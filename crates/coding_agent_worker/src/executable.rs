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
    let names = windows_launcher_names(command);
    #[cfg(not(windows))]
    let names = [command.to_owned()];
    find_named(paths, &names)
}

fn find_named(paths: &[PathBuf], names: &[String]) -> Option<PathBuf> {
    paths
        .iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|candidate| is_executable(candidate))
}

/// The file names Windows can launch for `command`. A bare name never matches
/// as it is: npm puts an extensionless shell script beside every `.cmd` shim,
/// and Windows cannot run it.
#[cfg(any(windows, test))]
fn windows_launcher_names(command: &str) -> Vec<String> {
    if Path::new(command).extension().is_some() {
        return vec![command.to_owned()];
    }
    ["exe", "cmd", "bat", "com"]
        .iter()
        .map(|extension| format!("{command}.{extension}"))
        .collect()
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

/// The program an npm `.cmd` shim runs, for a caller that cannot launch
/// `.cmd` files: Node's `child_process.spawn` refuses them without a shell.
/// Any other path comes back unchanged.
pub fn npm_shim_target_or_self(path: &Path) -> PathBuf {
    if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
        && let Ok(script) = std::fs::read_to_string(path)
        && let Some(target) = npm_shim_target(path, &script)
    {
        return target;
    }
    path.to_owned()
}

/// The path npm's `cmd-shim` runs, written relative to the shim's directory as
/// `"%dp0%\…"`. A shim for a Node script first names `%dp0%\node.exe`, so the
/// last such path is the target.
fn npm_shim_target(shim: &Path, script: &str) -> Option<PathBuf> {
    const SHIM_DIRECTORY: &str = "\"%dp0%\\";
    let start = script.rfind(SHIM_DIRECTORY)? + SHIM_DIRECTORY.len();
    let relative = script[start..].split('"').next()?;
    Some(
        relative
            .split('\\')
            .fold(shim.parent()?.to_owned(), |path, part| path.join(part)),
    )
}

#[cfg(all(test, unix))]
mod test;
