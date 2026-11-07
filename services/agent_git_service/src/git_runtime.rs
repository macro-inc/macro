//! Verify external executables before publishing the healthy HTTP listener.

use std::path::Path;
use std::process::Command;

#[cfg(test)]
mod test;

pub fn check(git: &Path) -> Result<(), rootcause::Report> {
    let version = Command::new(git)
        .arg("--version")
        .output()
        .map_err(|error| {
            rootcause::report!(
                "git is required by agent-git-service; install git in its runtime image: {error}"
            )
        })?;
    if !version.status.success() {
        return Err(rootcause::report!(
            "git --version failed; install git in the runtime image"
        ));
    }
    let exec_path = Command::new(git).arg("--exec-path").output()?;
    let path = String::from_utf8(exec_path.stdout)?;
    if !exec_path.status.success() || !Path::new(path.trim()).join("git-http-backend").is_file() {
        return Err(rootcause::report!(
            "git http-backend is required by agent-git-service; install the full git runtime"
        ));
    }
    Ok(())
}
