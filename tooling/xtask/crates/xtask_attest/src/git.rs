//! git, run on the repository a directory is in.

use std::{path::Path, process::Command};

use rootcause::prelude::*;

#[cfg(test)]
mod test;

/// Variables that point git at a repository other than the one in its
/// working directory, or at another account of its history. A git hook
/// exports the first ones, and `cargo x attest` is likely to be run from one.
const GIT_LOCATION: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
    "GIT_CONFIG",
    "GIT_SHALLOW_FILE",
    "GIT_GRAFT_FILE",
    "GIT_REPLACE_REF_BASE",
    "GIT_NO_REPLACE_OBJECTS",
];

/// A command that acts on the repository `dir` is in, whatever repository the
/// caller's environment names.
pub fn in_repository(program: &str, dir: &Path) -> Command {
    let mut command = Command::new(program);
    command.current_dir(dir);
    for variable in GIT_LOCATION {
        command.env_remove(variable);
    }
    command
}

/// Run git and return what it printed, as it printed it.
pub fn git_raw(dir: &Path, args: &[&str]) -> Result<Vec<u8>, Report> {
    let output = in_repository("git", dir)
        .args(args)
        .output()
        .context("could not run git")?;
    if !output.status.success() {
        bail!(
            "git {} failed in {}:\n{}",
            args.join(" "),
            dir.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

/// Run git and return its trimmed stdout.
pub fn git(dir: &Path, args: &[&str]) -> Result<String, Report> {
    Ok(String::from_utf8_lossy(&git_raw(dir, args)?)
        .trim()
        .to_owned())
}

/// `owner/name` from a GitHub remote, in its SSH form (`host:owner/name.git`)
/// or its HTTPS form (`https://github.com/owner/name`).
pub fn repository_of(remote_url: &str) -> Result<String, Report> {
    let path = remote_url.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = path.rsplit(['/', ':']);
    match (parts.next(), parts.next()) {
        (Some(name), Some(owner)) if !name.is_empty() && !owner.is_empty() => {
            Ok(format!("{owner}/{name}"))
        }
        _ => bail!("`{remote_url}` is not a GitHub repository URL"),
    }
}
