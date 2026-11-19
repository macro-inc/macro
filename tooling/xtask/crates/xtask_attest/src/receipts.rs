//! What this machine saw a check do: one file per check, definition and
//! tree, under the user's cache directory.
//!
//! A receipt is written when a check is run, not when anything is posted, so
//! the checks a developer runs while working are the record. `post` later
//! finds the receipts that apply to the commit `PR CI` will test. Every
//! worktree of a clone shares the receipts: they are keyed by the files, not by
//! where they were.

use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rootcause::{option_ext::OptionExt, prelude::*};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// Receipts older than this are removed when another is written.
const KEPT_FOR: Duration = Duration::from_secs(14 * 24 * 60 * 60);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Receipt {
    pub check: String,
    /// The check as it was defined when it ran.
    pub fingerprint: String,
    /// The tree it ran on.
    pub tree: String,
    pub passed: bool,
    /// The commit it ran on.
    pub commit: String,
    /// Seconds since the Unix epoch.
    pub at: u64,
}

pub struct Receipts {
    dir: PathBuf,
}

/// Where a clone's receipts and scratch files live: `~/.cache/macro-attest/<key>`.
pub fn cache_dir(common_dir: &Path) -> Result<PathBuf, Report> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .context("neither XDG_CACHE_HOME nor HOME is set")?;

    let key = hex::encode(&Sha256::digest(common_dir.to_string_lossy().as_bytes())[..6]);
    Ok(base.join("macro-attest").join(key))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

impl Receipts {
    pub fn open(dir: PathBuf) -> Result<Self, Report> {
        std::fs::create_dir_all(&dir).context(format!("could not create {}", dir.display()))?;
        Ok(Self { dir })
    }

    fn path(&self, check: &str, fingerprint: &str, tree: &str) -> PathBuf {
        self.dir.join(format!(
            "{}.{fingerprint}.{tree}.json",
            check.replace('/', "--")
        ))
    }

    /// Record what a check did on this tree, replacing what it did on it
    /// before.
    pub fn record(
        &self,
        check: &str,
        fingerprint: &str,
        tree: &str,
        passed: bool,
        commit: &str,
    ) -> Result<(), Report> {
        let receipt = Receipt {
            check: check.to_owned(),
            fingerprint: fingerprint.to_owned(),
            tree: tree.to_owned(),
            passed,
            commit: commit.to_owned(),
            at: now(),
        };
        let text = serde_json::to_string_pretty(&receipt).context("a receipt serializes")?;
        std::fs::write(self.path(check, fingerprint, tree), text)
            .context("could not write a receipt")?;
        self.forget_old();
        Ok(())
    }

    /// What the check did on exactly this tree, if this machine ran it.
    pub fn find(&self, check: &str, fingerprint: &str, tree: &str) -> Option<Receipt> {
        let text = std::fs::read_to_string(self.path(check, fingerprint, tree)).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Every receipt of a check, newest first.
    pub fn of(&self, check: &str) -> Vec<Receipt> {
        let prefix = format!("{}.", check.replace('/', "--"));
        let mut receipts: Vec<Receipt> = std::fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
            .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
            .filter_map(|text| serde_json::from_str(&text).ok())
            .collect();
        receipts.sort_by_key(|receipt: &Receipt| std::cmp::Reverse(receipt.at));
        receipts
    }

    fn forget_old(&self) {
        let oldest = now().saturating_sub(KEPT_FOR.as_secs());
        for entry in std::fs::read_dir(&self.dir).into_iter().flatten().flatten() {
            let stale = std::fs::read_to_string(entry.path())
                .ok()
                .and_then(|text| serde_json::from_str::<Receipt>(&text).ok())
                .is_some_and(|receipt| receipt.at < oldest);
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}
