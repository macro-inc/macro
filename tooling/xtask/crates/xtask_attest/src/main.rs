//! `cargo x attest`: run `PR CI` checks on this machine, and let the passes
//! count.
//!
//! `run` executes a check's scripts in the working tree and records what
//! happened, keyed by the check's definition and the git tree it ran on
//! ([`tree`]). It posts nothing: running a check while working is what makes
//! the record. `post` then finds the passes recorded for the tree `PR CI`
//! will test, the merge of the pushed head with its base branch, and posts
//! each as a commit status. `PR CI` skips a job whose status names the tree
//! it is about to test (`xtask_workflows`' `attestation` module has the
//! rules).
//!
//! A pass is for the files it ran on, all of them. When the base branch has
//! changes the branch lacks, `PR CI` tests another tree than the one in the
//! working tree, and `post` says so: merge the base, run again, push.

mod file_commands;
mod git;
mod github;
mod manifest;
mod receipts;
mod runner;
mod tree;

use std::{fs::File, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use rootcause::prelude::*;
use sha2::{Digest, Sha256};

use crate::{
    git::git,
    manifest::{Check, Manifest},
    receipts::Receipts,
    runner::{Machine, Outcome},
};

#[cfg(test)]
mod test;

/// How many paths a message names before it counts the rest.
const PATHS_SHOWN: usize = 3;
/// How many other commits with the head's tree `post` reads statuses of.
const SAME_TREE_COMMITS: usize = 5;

#[derive(Parser)]
#[command(
    name = "cargo x attest",
    about = "Run PR CI checks on this machine and let the passes count"
)]
struct Cli {
    #[command(subcommand)]
    command: Action,
}

#[derive(Subcommand)]
enum Action {
    /// List the checks that can be attested.
    List {
        /// Also list the jobs that can't be, and why.
        #[arg(long)]
        all: bool,
    },
    /// Run checks on the commit in this working tree and record the results.
    Run {
        /// Check ids from `list`, or `all` for every check this branch's
        /// changes make PR CI run.
        #[arg(required = true)]
        checks: Vec<String>,
        /// Run a check even when it already passed on this tree.
        #[arg(long)]
        again: bool,
        /// The branch the pull request merges into.
        #[arg(long, default_value = "main")]
        base: String,
    },
    /// Post the recorded passes that apply to what PR CI will test.
    Post {
        /// The branch the pull request merges into.
        #[arg(long, default_value = "main")]
        base: String,
    },
}

/// What `post` does about one check.
#[derive(Debug, PartialEq)]
enum Posting {
    /// A pass on this tree is recorded here and not yet on the commit.
    Pass,
    /// The commit says the check passed on a tree it has failed on since,
    /// here or on a runner.
    Withdraw,
    /// The commit already carries the pass.
    Standing,
    /// Something failed it on this tree, and the commit does not say it
    /// passed: a runner's audit, or a later run.
    Contradicted,
    /// This machine has no pass for this tree.
    Nothing,
}

/// What the statuses say about a check on one tree.
#[derive(Clone, Copy, Default)]
struct Said {
    /// The head carries a pass. `PR CI` reads the head only.
    passed_on_head: bool,
    /// The head carries a failure, which is final there.
    failed_on_head: bool,
    /// Another commit with the same tree carries a failure.
    failed_elsewhere: bool,
}

/// `recorded` is what this machine saw on exactly this tree. A failure
/// anywhere on the tree outweighs a pass, and a pass the head still carries
/// over such a failure has to be withdrawn there: nothing else reaches
/// `PR CI`.
fn posting(recorded: Option<bool>, said: Said) -> Posting {
    let failed = said.failed_on_head || said.failed_elsewhere || recorded == Some(false);
    if failed && said.passed_on_head && !said.failed_on_head {
        return Posting::Withdraw;
    }
    match recorded {
        Some(true) if failed => Posting::Contradicted,
        Some(true) if said.passed_on_head => Posting::Standing,
        Some(true) => Posting::Pass,
        Some(false) | None => Posting::Nothing,
    }
}

/// The first few of a list of paths, and how many more there are.
fn some_of(paths: &[String]) -> String {
    let shown = paths
        .iter()
        .take(PATHS_SHOWN)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    match paths.len().saturating_sub(PATHS_SHOWN) {
        0 => shown,
        more => format!("{shown} and {more} more"),
    }
}

/// The repository this was run in, and where its receipts are kept.
struct Repository {
    root: PathBuf,
    cache: PathBuf,
}

impl Repository {
    fn here() -> Result<Self, Report> {
        let here = std::env::current_dir().context("no current directory")?;
        let root = PathBuf::from(git(&here, &["rev-parse", "--show-toplevel"])?);
        let common_dir = PathBuf::from(git(
            &root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?);
        Ok(Self {
            cache: receipts::cache_dir(&common_dir)?,
            root,
        })
    }

    fn receipts(&self) -> Result<Receipts, Report> {
        Receipts::open(self.cache.join("receipts"))
    }

    /// One scratch directory per working tree, so two trees can run at once.
    fn scratch(&self) -> PathBuf {
        let key = hex::encode(&Sha256::digest(self.root.to_string_lossy().as_bytes())[..6]);
        self.cache.join(format!("scratch-{key}"))
    }

    /// Hold the working tree's scratch directory for one run. Two runs in
    /// one tree would write each other's scripts.
    fn lock(&self) -> Result<File, Report> {
        std::fs::create_dir_all(&self.cache)
            .context(format!("could not create {}", self.cache.display()))?;
        let mut path = self.scratch().into_os_string();
        path.push(".lock");
        let lock = File::create(path).context("could not create the lock file")?;
        if lock.try_lock().is_err() {
            eprintln!("waiting for another cargo x attest in this working tree to finish");
            lock.lock().context("could not take the lock")?;
        }
        Ok(lock)
    }

    /// What `PR CI` tests for a pushed head: GitHub's merge of it into its
    /// base, and that merge commit's tree.
    fn tested(&self, head: &str, base: &str) -> Result<(github::PullMerge, String), Report> {
        let github_repository =
            git::repository_of(&git(&self.root, &["remote", "get-url", "origin"])?)?;
        let merge = github::pull_request_merge(&github_repository, head, base)?;
        git(&self.root, &["fetch", "--quiet", "origin", &merge.sha])?;
        let tree = tree::tree_of(&self.root, &merge.sha)?;
        Ok((merge, tree))
    }

    /// The checks as a commit defines them.
    fn manifest_at(&self, commit: &str) -> Result<Manifest, Report> {
        let text = git(
            &self.root,
            &["show", &format!("{commit}:{}", manifest::PATH)],
        )
        .context(format!("{commit} has no {}", manifest::PATH))?;
        Manifest::parse(&text)
    }
}

fn list(all: bool) -> Result<(), Report> {
    let manifest = Repository::here()?.manifest_at("HEAD")?;
    for check in &manifest.checks {
        let steps: Vec<&str> = check.steps.iter().map(|step| step.name.as_str()).collect();
        println!("{:<48} {}: {}", check.id, check.name, steps.join(", "));
    }
    if all {
        println!();
        for job in &manifest.not_attestable {
            println!("{:<48} not attestable: {}", job.id, job.why);
        }
    }
    Ok(())
}

/// The checks asked for, in manifest order. `all` is every check whose
/// triggers differ from where the branch left `base`: `PR CI` runs no others.
fn requested<'a>(
    repository: &Repository,
    manifest: &'a Manifest,
    asked: &[String],
    base: &str,
) -> Result<Vec<&'a Check>, Report> {
    if !asked.iter().any(|id| id == "all") {
        for id in asked {
            if manifest.check(id).is_none() {
                bail!("`{id}` is not a check; `cargo x attest list` shows them");
            }
        }
        return Ok(manifest
            .checks
            .iter()
            .filter(|check| asked.contains(&check.id))
            .collect());
    }

    let Ok(fork) = git(
        &repository.root,
        &["merge-base", "HEAD", &format!("origin/{base}")],
    ) else {
        eprintln!("note: origin/{base} is not known here, so every check runs");
        return Ok(manifest.checks.iter().collect());
    };
    let mut triggered = Vec::new();
    for check in &manifest.checks {
        if tree::differs_under(&repository.root, &fork, "HEAD", &check.triggers)? {
            triggered.push(check);
        } else {
            println!(
                "-     {}: this branch changes nothing that makes PR CI run it",
                check.id
            );
        }
    }
    Ok(triggered)
}

fn run(asked: &[String], again: bool, base: &str) -> Result<bool, Report> {
    let repository = Repository::here()?;
    let _lock = repository.lock()?;
    let head = git(&repository.root, &["rev-parse", "HEAD"])?;
    let tree = tree::tree_of(&repository.root, &head)?;
    let manifest = repository.manifest_at("HEAD")?;
    let checks = requested(&repository, &manifest, asked, base)?;

    // Worth knowing before minutes of checks: when the head is pushed and its
    // pull request is open, whether what runs here can count. A head that is
    // not pushed yet has no answer, and the checks run all the same.
    if let Ok((_, tested)) = repository.tested(&head, base)
        && tested != tree
    {
        eprintln!("note: {}", behind_note(&head, base));
    }
    let receipts = repository.receipts()?;
    let machine = Machine {
        workspace: repository.root.clone(),
        scratch: repository.scratch(),
        tmp: std::env::temp_dir(),
    };

    // A result is recorded for a commit's files. With uncommitted changes a
    // check still runs, and nothing is recorded.
    let mut all_passed = true;
    let mut summary = Vec::new();
    for check in checks {
        let before = tree::uncommitted(&repository.root)?;

        // The point of a receipt: the same check on the same files has
        // nothing new to say.
        let passed_before = before.is_empty()
            && receipts
                .find(&check.id, &check.fingerprint, &tree)
                .is_some_and(|receipt| receipt.passed);
        if passed_before && !again {
            let line = format!("kept  {}: already passed on this tree", check.id);
            eprintln!("{line}");
            summary.push(line);
            continue;
        }

        eprintln!("── {}", check.id);
        let outcome = machine.run(check)?;

        // What ran is the commit's files only if nothing was uncommitted
        // before or after, and the commit is still the one checked out.
        let after = tree::uncommitted(&repository.root)?;
        let moved = git(&repository.root, &["rev-parse", "HEAD"])? != head;
        let unrecorded = if !before.is_empty() {
            Some(format!("uncommitted: {}", some_of(&before)))
        } else if !after.is_empty() {
            Some(format!("the check changed: {}", some_of(&after)))
        } else if moved {
            Some("HEAD moved while it ran".to_owned())
        } else {
            None
        };

        let passed = matches!(outcome, Outcome::Passed);
        all_passed &= passed;
        if unrecorded.is_none() {
            receipts.record(&check.id, &check.fingerprint, &tree, passed, &head)?;
        }
        let line = match (outcome, unrecorded) {
            (Outcome::Passed, None) => {
                format!("pass  {}: recorded for tree {}", check.id, &tree[..10])
            }
            (Outcome::Passed, Some(why)) => {
                format!("pass  {}: not recorded, {why}", check.id)
            }
            (Outcome::Failed { step }, None) => format!("FAIL  {}: `{step}` failed", check.id),
            (Outcome::Failed { step }, Some(why)) => {
                format!("FAIL  {}: `{step}` failed; not recorded, {why}", check.id)
            }
        };
        eprintln!("{line}");
        summary.push(line);
    }

    machine.clear();
    println!();
    for line in summary {
        println!("{line}");
    }
    Ok(all_passed)
}

/// Why this machine has no pass for the tree `PR CI` will test.
fn unrecorded(receipts: &Receipts, check: &Check) -> String {
    let Some(latest) = receipts.of(&check.id).into_iter().next() else {
        return "not run on this machine".to_owned();
    };
    if latest.fingerprint != check.fingerprint {
        return "the job is defined differently in what PR CI tests".to_owned();
    }
    let ran_on = latest.commit.get(..10).unwrap_or(&latest.commit);
    format!("it ran here on {ran_on}, whose files are not this commit's; run it again")
}

/// What to do when `PR CI` tests another tree than the head's: GitHub built
/// its merge commit, at the push, from a base that had changes the branch
/// lacked. Nothing run on the head applies.
fn behind_note(head: &str, base: &str) -> String {
    format!(
        "{base} had changes {} lacked when it was pushed, so PR CI tests other files than this commit's and no pass recorded here applies.\nMerge {base} and push in one go, then run the checks: git fetch origin {base} && git merge origin/{base} && git push",
        &head[..10]
    )
}

fn post(base: &str) -> Result<(), Report> {
    let repository = Repository::here()?;
    let head = git(&repository.root, &["rev-parse", "HEAD"])?;
    let github_repository =
        git::repository_of(&git(&repository.root, &["remote", "get-url", "origin"])?)?;
    let receipts = repository.receipts()?;

    // The checks and the tree are read from what PR CI tests, not from this
    // working tree.
    let (merge, tested) = repository.tested(&head, base)?;
    let manifest = repository.manifest_at(&merge.sha)?;
    eprintln!(
        "#{}: PR CI tests tree {}, the merge of {} into {base}",
        merge.number,
        &tested[..10],
        &head[..10]
    );
    if tested != tree::tree_of(&repository.root, &head)? {
        println!("{}", behind_note(&head, base));
        return Ok(());
    }

    // PR CI reads the head's statuses. A failure on another commit with the
    // same files, one this head reworded, amended or followed with an empty
    // commit, was about these files, so those are read too. GitHub answers
    // with no statuses for a commit it never saw, so an error here is one.
    let on_head = github::statuses(&github_repository, &head)?;
    let mut elsewhere = Vec::new();
    for other in tree::same_tree_elsewhere(&repository.root, &head, SAME_TREE_COMMITS)? {
        elsewhere.extend(github::statuses(&github_repository, &other)?);
    }

    for check in &manifest.checks {
        let context = format!("{}{}", manifest.status_prefix, check.id);
        let about_this_tree = |status: &&github::Status| {
            status.context.eq_ignore_ascii_case(&context)
                && status.claim().is_some_and(|claim| {
                    claim.fingerprint == check.fingerprint && claim.tree == tested
                })
        };
        let failed = |statuses: &[github::Status]| {
            statuses
                .iter()
                .filter(about_this_tree)
                .any(|status| status.state != "success")
        };
        let said = Said {
            passed_on_head: on_head
                .iter()
                .filter(about_this_tree)
                .any(|status| status.state == "success"),
            failed_on_head: failed(&on_head),
            failed_elsewhere: failed(&elsewhere),
        };
        let recorded = receipts
            .find(&check.id, &check.fingerprint, &tested)
            .map(|receipt| receipt.passed);

        // A failure someone else recorded for this tree is this machine's to
        // remember: the same files on a later commit must not pass again.
        if recorded == Some(true) && (said.failed_on_head || said.failed_elsewhere) {
            receipts.record(&check.id, &check.fingerprint, &tested, false, &head)?;
        }

        let line = match posting(recorded, said) {
            Posting::Pass => {
                github::post_status(
                    &github_repository,
                    &head,
                    "success",
                    &context,
                    &github::description(&check.fingerprint, &tested, None),
                )?;
                format!("post  {}: attested on {}", check.id, &head[..10])
            }
            Posting::Withdraw => {
                github::post_status(
                    &github_repository,
                    &head,
                    "failure",
                    &context,
                    &github::description(
                        &check.fingerprint,
                        &tested,
                        Some("failed on these files since it was attested"),
                    ),
                )?;
                format!(
                    "FAIL  {}: failed on this tree since; its attestation is withdrawn",
                    check.id
                )
            }
            Posting::Standing => {
                format!("kept  {}: already attested on {}", check.id, &head[..10])
            }
            Posting::Contradicted => format!(
                "-     {}: something failed it on this tree, so it runs in PR CI",
                check.id
            ),
            Posting::Nothing if recorded == Some(false) => {
                format!("-     {}: failed here; it runs in PR CI", check.id)
            }
            Posting::Nothing => format!("-     {}: {}", check.id, unrecorded(&receipts, check)),
        };
        println!("{line}");
    }
    Ok(())
}

fn main() -> ExitCode {
    let outcome = match Cli::parse().command {
        Action::List { all } => list(all).map(|()| true),
        Action::Run {
            checks,
            again,
            base,
        } => run(&checks, again, &base),
        Action::Post { base } => post(&base).map(|()| true),
    };

    match outcome {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(report) => {
            eprintln!("{report}");
            ExitCode::FAILURE
        }
    }
}
