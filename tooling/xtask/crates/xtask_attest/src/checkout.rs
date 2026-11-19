//! The tree a check runs on: the pull request's merge with its base branch,
//! checked out in a repository of its own.
//!
//! `PR CI` tests the merge commit GitHub builds, base first and head second,
//! and its steps read both parents. The same merge is built here and checked
//! out under the user's cache directory, never in the working tree: the
//! attestation is for the commit, not for uncommitted edits, and a job's
//! steps fetch, clean and rewrite files as they would on a runner.
//!
//! The checkout borrows the source repository's objects (git alternates), so
//! it costs no clone, but it has its own refs, its own shallow boundary and
//! its own build directories. One lock per source repository lets one
//! attestation run at a time, whichever worktree starts it.

use std::{
    fs::File,
    path::{Path, PathBuf},
    process::Command,
};

use rootcause::{option_ext::OptionExt, prelude::*};
use sha2::{Digest, Sha256};

/// The merge of a commit with its base, ready to run checks on.
pub struct Checkout {
    pub dir: PathBuf,
    /// The source repository's git directory, whose objects the checkout reads.
    common_dir: PathBuf,
    /// Holds what outlives one run: the checkout, the runner's home.
    pub cache: PathBuf,
    pub head: String,
    pub base: String,
    pub merge: String,
    pub base_branch: String,
    /// `owner/name` on GitHub.
    pub repository: String,
    /// Whether history is cut short, as it is when the source is a shallow clone.
    pub shallow: bool,
    /// The pull request's files as GitHub lists them: a rename is two paths.
    pub changed_files: Vec<String>,
    /// Released when the checkout is dropped.
    _lock: File,
}

/// Run git and return its trimmed stdout.
pub fn git(dir: &Path, args: &[&str]) -> Result<String, Report> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
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
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
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

fn cache_dir(common_dir: &Path) -> Result<PathBuf, Report> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .context("neither XDG_CACHE_HOME nor HOME is set")?;

    let key = hex::encode(&Sha256::digest(common_dir.to_string_lossy().as_bytes())[..6]);
    Ok(base.join("macro-attest").join(key))
}

/// Make `dir` a repository that reads the source's objects and fetches from
/// its remote.
fn initialize(dir: &Path, common_dir: &Path, remote_url: &str) -> Result<(), Report> {
    if dir.join(".git").is_dir() {
        return Ok(());
    }

    std::fs::create_dir_all(dir).context(format!("could not create {}", dir.display()))?;
    git(dir, &["init", "--quiet"])?;
    std::fs::write(
        dir.join(".git/objects/info/alternates"),
        format!("{}\n", common_dir.join("objects").display()),
    )
    .context("could not point the checkout at the source repository's objects")?;
    git(dir, &["remote", "add", "origin", remote_url])?;
    Ok(())
}

/// A shallow source knows where its history stops, and the checkout reads
/// history through the source's objects, so it takes the source's boundary
/// as it is. A step's own `git fetch --depth` would otherwise leave a
/// boundary at a commit whose parents are all there, and hide them from the
/// next merge.
fn take_shallow_boundary(dir: &Path, common_dir: &Path) -> Result<(), Report> {
    let own = dir.join(".git/shallow");
    match std::fs::read(common_dir.join("shallow")) {
        Ok(boundary) => {
            std::fs::write(&own, boundary)
                .context("could not write the checkout's shallow boundary")?;
        }
        Err(_) if own.exists() => {
            std::fs::remove_file(&own)
                .context("could not clear the checkout's shallow boundary")?;
        }
        Err(_) => {}
    }
    Ok(())
}

impl Checkout {
    /// Put the checkout back to the merge commit, as a runner's fresh
    /// checkout is for every job: tracked files restored, untracked files
    /// removed, history as the source has it. Ignored files (build output,
    /// installed packages) stay, as they do on a runner's cache volume.
    pub fn restore(&self) -> Result<(), Report> {
        take_shallow_boundary(&self.dir, &self.common_dir)?;
        git(
            &self.dir,
            &["checkout", "--quiet", "--force", "--detach", &self.merge],
        )?;
        git(&self.dir, &["clean", "--quiet", "-fd"])?;
        Ok(())
    }
}

/// Build the merge of `HEAD` with the remote's `base_branch` and check it out.
/// `source` is any directory of the repository the commit lives in.
pub fn prepare(source: &Path, base_branch: &str) -> Result<Checkout, Report> {
    let head = git(source, &["rev-parse", "HEAD"])?;
    let common_dir = PathBuf::from(git(
        source,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?);
    let remote_url = git(source, &["remote", "get-url", "origin"])?;

    if !git(source, &["status", "--porcelain"])?.is_empty() {
        eprintln!(
            "note: uncommitted changes are not part of what is attested ({})",
            &head[..10]
        );
    }

    git(source, &["fetch", "--quiet", "origin", base_branch])?;
    let base = git(source, &["rev-parse", &format!("origin/{base_branch}")])?;

    let cache = cache_dir(&common_dir)?;
    std::fs::create_dir_all(&cache).context(format!("could not create {}", cache.display()))?;
    let lock = File::create(cache.join("lock")).context("could not create the lock file")?;
    if lock.try_lock().is_err() {
        eprintln!("waiting for another cargo x attest on this repository to finish");
        lock.lock().context("could not take the attestation lock")?;
    }

    let dir = cache.join("checkout");
    initialize(&dir, &common_dir, &remote_url)?;
    take_shallow_boundary(&dir, &common_dir)?;

    // The merge GitHub would build: base first, head second.
    let tree = git(&dir, &["merge-tree", "--write-tree", &base, &head]).context(format!(
        "{} does not merge cleanly with origin/{base_branch}; PR CI could not run on it either",
        &head[..10]
    ))?;
    let merge = Command::new("git")
        .args(["commit-tree", &tree, "-p", &base, "-p", &head, "-m"])
        .arg(format!("Merge {head} into {base}"))
        .envs([
            ("GIT_AUTHOR_NAME", "cargo x attest"),
            ("GIT_AUTHOR_EMAIL", "attest@localhost"),
            ("GIT_COMMITTER_NAME", "cargo x attest"),
            ("GIT_COMMITTER_EMAIL", "attest@localhost"),
        ])
        .current_dir(&dir)
        .output()
        .context("could not run git commit-tree")?;
    if !merge.status.success() {
        bail!(
            "could not create the merge commit: {}",
            String::from_utf8_lossy(&merge.stderr).trim()
        );
    }
    let merge = String::from_utf8_lossy(&merge.stdout).trim().to_owned();

    git(
        &dir,
        &[
            "update-ref",
            &format!("refs/remotes/origin/{base_branch}"),
            &base,
        ],
    )?;
    let merge_base = git(&dir, &["merge-base", &base, &head])?;
    let changed_files = git(
        &dir,
        &["diff", "--name-only", "--no-renames", &merge_base, &head],
    )?
    .lines()
    .map(str::to_owned)
    .collect();

    let shallow = git(&dir, &["rev-parse", "--is-shallow-repository"])? == "true";
    let checkout = Checkout {
        dir,
        common_dir,
        cache,
        head,
        base,
        merge,
        base_branch: base_branch.to_owned(),
        repository: repository_of(&remote_url)?,
        shallow,
        changed_files,
        _lock: lock,
    };
    checkout.restore()?;
    Ok(checkout)
}
