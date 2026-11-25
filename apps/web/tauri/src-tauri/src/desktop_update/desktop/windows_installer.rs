//! Hands a verified NSIS installer to Windows.
//!
//! `tauri_plugin_updater::Update::install` would run the installer too, but it
//! ends the process itself with `std::process::exit`, which skips
//! `RunEvent::Exit` (window state, macrod, the native cache), and in passive
//! mode it always passes `/R`. Quitting with an update ready, which on Windows
//! includes closing the last window, would then open Macro again once the
//! installer finished. Here the app starts the installer and exits normally;
//! `/R` is passed only when the person chose Restart.

/// `/P` shows only a progress bar, `/UPDATE` keeps the installed app's
/// shortcuts, and `/R` opens Macro once the install finishes.
pub(super) fn installer_args(reopen: bool) -> &'static [&'static str] {
    if reopen {
        &["/P", "/UPDATE", "/R"]
    } else {
        &["/P", "/UPDATE"]
    }
}

/// Writes the installer to a new temporary directory and starts it. The
/// per-user installer runs without elevation, so a plain process spawn
/// suffices. Its own check for a running Macro waits for (or ends) this
/// process before it replaces any file.
#[cfg(windows)]
pub(super) fn launch(
    version: &str,
    bytes: &[u8],
    reopen: bool,
) -> Result<(), super::super::report::Failure> {
    use super::super::report::{Failure, FailureKind};
    use std::process::{Command, Stdio};

    // download() verified the minisign signature; this only refuses a feed
    // entry that points at something other than an installer.
    if !bytes.starts_with(b"MZ") {
        return Err(Failure::new(FailureKind::Install));
    }
    let directory =
        std::env::temp_dir().join(format!("Macro-{version}-update-{}", std::process::id()));
    std::fs::create_dir_all(&directory).map_err(|error| Failure::io(&error))?;
    let installer = directory.join(format!("Macro-{version}-setup.exe"));
    std::fs::write(&installer, bytes).map_err(|error| Failure::io(&error))?;
    Command::new(&installer)
        .args(installer_args(reopen))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| Failure::io(&error))?;
    Ok(())
}

#[cfg(test)]
mod test;
