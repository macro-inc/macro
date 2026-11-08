//! Content keys over repository paths as they are on disk: tracked, modified
//! and untracked (non-ignored) files alike. The machine-wide caches (static
//! bundles, content-tagged images) are keyed by these, so an edit anywhere in
//! an input changes the key whether or not it was committed. Entries of those
//! caches and of the init snapshots go into place through [`install_entry`].

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

/// Mode, blob hash and path of every non-ignored file under `paths` (relative
/// to `repo`; missing ones are skipped). A copy of the checkout's index is
/// updated from the working tree, so only changed files are read, and the real
/// index is left alone.
pub fn tracked(repo: &Path, paths: &[&str]) -> Result<Vec<u8>> {
    // `git add` fails on a pathspec that matches nothing.
    let present: Vec<&str> = paths
        .iter()
        .copied()
        .filter(|path| repo.join(path).exists())
        .collect();
    let index = git(repo, &["rev-parse", "--git-path", "index"], None)?;
    let index = repo.join(String::from_utf8_lossy(&index).trim());
    let scratch = scratch_dir()?;
    let copy = scratch.join("index");
    // A brand-new worktree may not have written its index yet.
    if index.exists() {
        std::fs::copy(&index, &copy).with_context(|| format!("copying {}", index.display()))?;
    }
    let result = (|| {
        let mut add = vec!["add", "-A", "--"];
        add.extend(&present);
        git(repo, &add, Some(&copy))?;
        let mut list = vec!["ls-files", "-s", "--"];
        list.extend(&present);
        git(repo, &list, Some(&copy))
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    result
}

/// [`tracked`] hashed to hex.
pub fn of_paths(repo: &Path, paths: &[&str]) -> Result<String> {
    Ok(hex(&Sha256::digest(tracked(repo, paths)?)))
}

/// Move a finished `tmp` into place at `entry` without ever removing a
/// complete entry (`is_complete`), which another checkout may have installed
/// meanwhile and may be reading. A rename onto a non-empty directory fails, so
/// the rename goes first; only an incomplete leftover is removed before one
/// retry.
pub fn install_entry(tmp: &Path, entry: &Path, is_complete: impl Fn(&Path) -> bool) -> Result<()> {
    if std::fs::rename(tmp, entry).is_ok() {
        return Ok(());
    }
    if !is_complete(entry) {
        let _ = std::fs::remove_dir_all(entry);
        if std::fs::rename(tmp, entry).is_ok() {
            return Ok(());
        }
    }
    anyhow::ensure!(
        is_complete(entry),
        "could not move {} into place at {}",
        tmp.display(),
        entry.display()
    );
    std::fs::remove_dir_all(tmp).with_context(|| format!("removing {}", tmp.display()))
}

pub fn git(repo: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo).args(args);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    let out = cmd.output().context("running git")?;
    anyhow::ensure!(
        out.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(out.stdout)
}

/// A private directory for the index copy, unique per process and thread.
fn scratch_dir() -> Result<PathBuf> {
    let home = macro_env_var::maybe_read_env("HOME").context("HOME is not set")?;
    let dir = PathBuf::from(home).join(format!(
        ".cache/macro-local/.index-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod test;
