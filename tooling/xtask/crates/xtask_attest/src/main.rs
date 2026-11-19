//! `cargo x attest`: run `PR CI` checks on this machine, and let the passes
//! count.
//!
//! `run` executes a check's scripts in the working tree and records what
//! happened, keyed by the check's definition and a hash of the files it read
//! ([`inputs`]). It posts nothing: running a check while working is what makes
//! the record. `post` then finds the recorded passes that apply to the commit
//! `PR CI` will test, the merge of the pushed head with its base branch, and
//! posts each as a commit status. `PR CI` skips a job whose status names the
//! files it is about to test (`xtask_workflows`' `attestation` module has the
//! rules).
//!
//! A pass is for the bytes it ran on. A commit that leaves a check's inputs
//! alone keeps its pass; a commit, or a move of the base branch, that changes
//! one of them does not, and `post` says which input changed.

mod file_commands;
mod git;
mod github;
mod inputs;
mod manifest;
mod receipts;
mod runner;

use std::{path::PathBuf, process::ExitCode};

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
        /// Check ids from `list`, or `all` for every check whose inputs this
        /// branch changes.
        #[arg(required = true)]
        checks: Vec<String>,
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
    /// A pass on these files is recorded here and not yet on the commit.
    Pass,
    /// The check failed here on files the commit says it passed on.
    Withdraw,
    /// The commit already carries the pass.
    Standing,
    /// Something failed it on these files: a runner's audit, or a later run.
    Contradicted,
    /// This machine has no pass for these files.
    Nothing,
}

/// `recorded` is what this machine saw on exactly these files; the flags are
/// what the commit's statuses say about them.
fn posting(recorded: Option<bool>, says_passed: bool, says_failed: bool) -> Posting {
    match recorded {
        Some(true) if says_failed => Posting::Contradicted,
        Some(true) if says_passed => Posting::Standing,
        Some(true) => Posting::Pass,
        Some(false) if says_passed && !says_failed => Posting::Withdraw,
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

    /// One scratch directory per working tree, so two can run at once.
    fn scratch(&self) -> PathBuf {
        let key = hex::encode(&Sha256::digest(self.root.to_string_lossy().as_bytes())[..6]);
        self.cache.join(format!("scratch-{key}"))
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

    /// The hash of a check's inputs in a commit.
    fn source(&self, commit: &str, check: &Check) -> Result<String, Report> {
        let objects = inputs::objects_at(&self.root, commit, &check.inputs)?;
        Ok(inputs::inputs_hash(&check.inputs, &objects))
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

/// The checks asked for, in manifest order. `all` is every check whose inputs
/// differ from where the branch left `base`: `PR CI` runs no others.
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
    let mut changed = Vec::new();
    for check in &manifest.checks {
        if repository.source(&fork, check)? == repository.source("HEAD", check)? {
            println!("-     {}: this branch does not change its inputs", check.id);
        } else {
            changed.push(check);
        }
    }
    Ok(changed)
}

fn run(asked: &[String], base: &str) -> Result<bool, Report> {
    let repository = Repository::here()?;
    let head = git(&repository.root, &["rev-parse", "HEAD"])?;
    let manifest = repository.manifest_at("HEAD")?;
    let checks = requested(&repository, &manifest, asked, base)?;
    let receipts = repository.receipts()?;
    let machine = Machine {
        workspace: repository.root.clone(),
        scratch: repository.scratch(),
    };

    // A result is recorded for a commit's files. With uncommitted changes
    // under its inputs a check still runs, and nothing is recorded.
    let mut all_passed = true;
    let mut summary = Vec::new();
    for check in checks {
        let before = inputs::uncommitted(&repository.root, &check.inputs)?;
        let source = repository.source(&head, check)?;

        eprintln!("── {}", check.id);
        let line = match machine.run(check)? {
            Outcome::Failed { step } => {
                all_passed = false;
                if before.is_empty() {
                    receipts.record(&check.id, &check.fingerprint, &source, false, &head)?;
                }
                format!("FAIL  {}: `{step}` failed", check.id)
            }
            Outcome::Passed if !before.is_empty() => format!(
                "pass  {}: not recorded, uncommitted: {}",
                check.id,
                some_of(&before)
            ),
            Outcome::Passed => {
                let after = inputs::uncommitted(&repository.root, &check.inputs)?;
                if !after.is_empty() {
                    format!(
                        "pass  {}: not recorded, the check changed: {}",
                        check.id,
                        some_of(&after)
                    )
                } else if git(&repository.root, &["rev-parse", "HEAD"])? != head {
                    format!("pass  {}: not recorded, HEAD moved while it ran", check.id)
                } else {
                    receipts.record(&check.id, &check.fingerprint, &source, true, &head)?;
                    format!("pass  {}: recorded for {source}", check.id)
                }
            }
        };
        eprintln!("{line}");
        summary.push(line);
    }

    println!();
    for line in summary {
        println!("{line}");
    }
    Ok(all_passed)
}

/// Why this machine has no pass for the files `PR CI` will test.
fn unrecorded(repository: &Repository, receipts: &Receipts, check: &Check, merge: &str) -> String {
    let Some(latest) = receipts.of(&check.id).into_iter().next() else {
        return "not run on this machine".to_owned();
    };
    if latest.fingerprint != check.fingerprint {
        return "the job is defined differently in what PR CI tests".to_owned();
    }

    let changed = inputs::objects_at(&repository.root, &latest.commit, &check.inputs)
        .and_then(|ran| {
            let tested = inputs::objects_at(&repository.root, merge, &check.inputs)?;
            Ok(inputs::differing(&check.inputs, &ran, &tested))
        })
        .unwrap_or_default();
    if changed.is_empty() {
        return "it ran here on other files than PR CI tests".to_owned();
    }
    format!(
        "{} differ between {} and what PR CI tests; bring the branch up to date and run it again",
        some_of(&changed),
        latest.commit.get(..10).unwrap_or(&latest.commit)
    )
}

fn post(base: &str) -> Result<(), Report> {
    let repository = Repository::here()?;
    let head = git(&repository.root, &["rev-parse", "HEAD"])?;
    let github_repository =
        git::repository_of(&git(&repository.root, &["remote", "get-url", "origin"])?)?;
    let receipts = repository.receipts()?;

    // What PR CI tests: GitHub's merge of the pushed head into its base. The
    // checks and their inputs are read from there, not from this tree.
    let merge = github::pull_request_merge(&github_repository, &head, base)?;
    git(
        &repository.root,
        &["fetch", "--quiet", "origin", &merge.sha],
    )?;
    let manifest = repository.manifest_at(&merge.sha)?;
    let statuses = github::statuses(&github_repository, &head)?;
    eprintln!(
        "#{}: PR CI tests {}, the merge of {} into {base}",
        merge.number,
        &merge.sha[..10],
        &head[..10]
    );

    for check in &manifest.checks {
        let context = format!("{}{}", manifest.status_prefix, check.id);
        let source = repository.source(&merge.sha, check)?;
        let about_these_files: Vec<&github::Status> = statuses
            .iter()
            .filter(|status| status.context.eq_ignore_ascii_case(&context))
            .filter(|status| {
                status.claim().is_some_and(|claim| {
                    claim.fingerprint == check.fingerprint && claim.source == source
                })
            })
            .collect();
        let says_passed = about_these_files
            .iter()
            .any(|status| status.state == "success");
        let says_failed = about_these_files
            .iter()
            .any(|status| status.state != "success");
        let recorded = receipts
            .find(&check.id, &check.fingerprint, &source)
            .map(|receipt| receipt.passed);

        let line = match posting(recorded, says_passed, says_failed) {
            Posting::Pass => {
                github::post_status(
                    &github_repository,
                    &head,
                    "success",
                    &context,
                    &github::description(&check.fingerprint, &source, None),
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
                        &source,
                        Some("failed on the machine that attested it"),
                    ),
                )?;
                format!(
                    "FAIL  {}: failed here since; its attestation is withdrawn",
                    check.id
                )
            }
            Posting::Standing => {
                format!("kept  {}: already attested on {}", check.id, &head[..10])
            }
            Posting::Contradicted => format!(
                "-     {}: something failed it on these files, so it runs in PR CI",
                check.id
            ),
            Posting::Nothing if recorded == Some(false) => {
                format!("-     {}: failed here; it runs in PR CI", check.id)
            }
            Posting::Nothing => format!(
                "-     {}: {}",
                check.id,
                unrecorded(&repository, &receipts, check, &merge.sha)
            ),
        };
        println!("{line}");
    }
    Ok(())
}

fn main() -> ExitCode {
    let outcome = match Cli::parse().command {
        Action::List { all } => list(all).map(|()| true),
        Action::Run { checks, base } => run(&checks, &base),
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
