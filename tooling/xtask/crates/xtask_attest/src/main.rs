//! `cargo x attest`: run `PR CI` jobs on this machine and attest the result.
//!
//! `cargo x attest run <check>...` builds the merge of `HEAD` with `main`,
//! runs each check's job there as a runner would ([`runner`]), and with
//! `--post` records every pass as a commit status on `HEAD`. A requested
//! `PR CI` run then skips those jobs (`xtask_workflows`' `attestation`
//! module has the rules). Without `--post` nothing leaves the machine.
//!
//! With `--post` the merge is the one GitHub built for the pull request, and
//! the status names its base commit: `PR CI` accepts it for that merge only.
//!
//! A check that fails here posts no pass, so its job runs in `PR CI`; a pass
//! posted for the same commit earlier is withdrawn.

mod checkout;
mod expression;
mod file_commands;
mod github;
mod manifest;
mod paths_filter;
mod runner;

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::{Parser, Subcommand};
use rootcause::prelude::*;

use crate::{
    checkout::{Base, Checkout},
    manifest::{Check, Manifest},
    runner::{JobResult, Machine, Outputs, Plan},
};

#[derive(Parser)]
#[command(
    name = "cargo x attest",
    about = "Run PR CI jobs on this machine and attest their result"
)]
struct Cli {
    #[command(subcommand)]
    command: Action,
}

#[derive(Subcommand)]
enum Action {
    /// List the checks that can be attested.
    List,
    /// Run checks on the merge of HEAD with the base branch.
    Run {
        /// Check ids from `list`, or `all` for every check PR CI would run.
        #[arg(required = true)]
        checks: Vec<String>,
        /// Post a commit status on HEAD for each check that passes.
        #[arg(long)]
        post: bool,
        /// The branch the pull request merges into.
        #[arg(long, default_value = "main")]
        base: String,
    },
}

/// What happened to one requested check.
enum Verdict {
    /// `PR CI` would not run it for this change, so there is nothing to attest.
    NotNeeded,
    Passed {
        description: String,
    },
    Failed {
        step: String,
    },
    /// This machine can't run it as a runner would; why.
    Unavailable(String),
}

fn load(root: &Path, workflow: &str) -> Result<serde_yaml::Value, Report> {
    let path = root.join(".github/workflows").join(workflow);
    let text =
        std::fs::read_to_string(&path).context(format!("could not read {}", path.display()))?;
    Ok(serde_yaml::from_str(&text).context(format!("{workflow} is not YAML"))?)
}

fn source_root() -> Result<PathBuf, Report> {
    let here = std::env::current_dir().context("no current directory")?;
    Ok(PathBuf::from(checkout::git(
        &here,
        &["rev-parse", "--show-toplevel"],
    )?))
}

fn list() -> Result<(), Report> {
    let manifest = Manifest::read(&source_root()?)?;
    for check in &manifest.checks {
        println!("{:<48} {}", check.id, check.steps.join(", "));
    }
    Ok(())
}

/// The checks asked for, in manifest order.
fn requested<'a>(manifest: &'a Manifest, asked: &[String]) -> Result<Vec<&'a Check>, Report> {
    if asked.iter().any(|id| id == "all") {
        return Ok(manifest.checks.iter().collect());
    }
    for id in asked {
        if !manifest.checks.iter().any(|check| &check.id == id) {
            bail!("`{id}` is not a check; `cargo x attest list` shows them");
        }
    }
    Ok(manifest
        .checks
        .iter()
        .filter(|check| asked.contains(&check.id))
        .collect())
}

/// Runs the checks of one checkout, remembering what `PR CI` decides once
/// per run: which calls its path filters start, and each workflow's selection.
struct Session<'a> {
    machine: Machine<'a>,
    caller: serde_yaml::Value,
    /// `needs` as the caller's call jobs see it: the start job's outputs.
    caller_needs: BTreeMap<String, Outputs>,
    /// The selector job's outputs, per workflow file; `None` when it failed.
    selections: BTreeMap<String, Option<Outputs>>,
    base: String,
}

impl Session<'_> {
    fn condition(
        &self,
        condition: Option<&str>,
        needs: &BTreeMap<String, Outputs>,
    ) -> Result<bool, Report> {
        struct Needs<'a>(&'a BTreeMap<String, Outputs>);
        impl expression::Contexts for Needs<'_> {
            fn lookup(&self, path: &[String]) -> Result<expression::Value, Report> {
                match path {
                    [needs, job, outputs, name] if needs == "needs" && outputs == "outputs" => {
                        Ok(self
                            .0
                            .get(job)
                            .and_then(|outputs| outputs.get(name))
                            .map_or(expression::Value::Null, |value| {
                                expression::Value::String(value.clone())
                            }))
                    }
                    _ => bail!("a job condition reads `{}`", path.join(".")),
                }
            }
        }

        match condition {
            Some(condition) => Ok(expression::evaluate(condition, &Needs(needs))?.truthy()),
            None => Ok(true),
        }
    }

    fn run(&mut self, check: &Check) -> Result<Verdict, Report> {
        // The caller's path filter comes first: a call that does not start
        // runs none of its jobs.
        let call_condition = runner::scalar(&self.caller["jobs"][check.call.as_str()]["if"]);
        if !self.condition(call_condition.as_deref(), &self.caller_needs)? {
            return Ok(Verdict::NotNeeded);
        }

        let workflow = load(&self.machine.workspace, &check.workflow)?;
        let selector = self.machine.manifest.selector_job.clone();

        let mut needs = BTreeMap::new();
        if check.selected {
            if !self.selections.contains_key(&check.workflow) {
                eprintln!("── {} / {selector}", check.workflow);
                let selection = match self.machine.run_job(
                    &workflow,
                    &selector,
                    &Plan::EveryStep,
                    &BTreeMap::new(),
                )? {
                    JobResult::Passed(outputs) => Some(outputs),
                    JobResult::Failed { .. } | JobResult::Unavailable(_) => None,
                };
                self.selections.insert(check.workflow.clone(), selection);
            }
            let Some(selection) = self.selections[&check.workflow].clone() else {
                return Ok(Verdict::Failed {
                    step: format!("{selector} (the job that selects what runs)"),
                });
            };
            needs.insert(selector, selection);
        }

        if !self.condition(check.condition.as_deref(), &needs)? {
            return Ok(Verdict::NotNeeded);
        }

        eprintln!("── {}", check.id);
        match self
            .machine
            .run_job(&workflow, &check.job, &Plan::Steps(&check.steps), &needs)?
        {
            JobResult::Failed { step } => Ok(Verdict::Failed { step }),
            JobResult::Unavailable(why) => Ok(Verdict::Unavailable(why)),
            JobResult::Passed(_) => {
                let digest = match needs.values().next() {
                    Some(selection) => runner::inputs_digest(&check.inputs, selection),
                    None => "-".to_owned(),
                };
                Ok(Verdict::Passed {
                    description: format!("fp={} in={digest} base={}", check.fingerprint, self.base),
                })
            }
        }
    }
}

/// Do what one verdict calls for on the commit, and say it in a line.
/// `posted` holds the commit's newest statuses when the run posts.
fn settle(
    checkout: &Checkout,
    manifest: &Manifest,
    posted: Option<&BTreeMap<String, String>>,
    check: &Check,
    verdict: &Verdict,
) -> Result<String, Report> {
    let context = format!("{}{}", manifest.status_prefix, check.id);
    let post = |state: &str, description: &str| {
        github::post_status(
            &checkout.repository,
            &checkout.head,
            state,
            &context,
            description,
        )
    };

    Ok(match verdict {
        Verdict::NotNeeded => format!("-     {}: PR CI does not run it for this change", check.id),
        Verdict::Unavailable(why) => {
            format!("skip  {}: {why}; its job will run in PR CI", check.id)
        }
        Verdict::Failed { step } => {
            let attested = posted
                .and_then(|posted| posted.get(&context.to_lowercase()))
                .is_some_and(|state| state == "success");
            if attested {
                post(
                    "failure",
                    &format!("`{step}` failed on the attesting machine"),
                )?;
            }
            format!(
                "FAIL  {}: `{step}` failed; its job will run in PR CI{}",
                check.id,
                if attested {
                    " (withdrew the earlier attestation)"
                } else {
                    ""
                }
            )
        }
        Verdict::Passed { description } if posted.is_some() => {
            post("success", description)?;
            format!(
                "pass  {}: posted {context} on {}",
                check.id,
                &checkout.head[..10]
            )
        }
        Verdict::Passed { description } => format!(
            "pass  {}: would post {context} \"{description}\" (--post)",
            check.id
        ),
    })
}

fn run(asked: &[String], post_statuses: bool, base_branch: &str) -> Result<bool, Report> {
    let base = if post_statuses {
        Base::PullRequest
    } else {
        Base::Tip
    };
    let checkout = checkout::prepare(&source_root()?, base_branch, base)?;
    eprintln!(
        "attesting {} merged with origin/{base_branch} at {} in {}",
        &checkout.head[..10],
        &checkout.base[..10],
        checkout.dir.display()
    );

    // The checks are the merged tree's: a job that changed on the base branch
    // is run, and fingerprinted, as PR CI will run it.
    let manifest = Manifest::read(&checkout.dir)?;
    let checks = requested(&manifest, asked)?;

    let scratch = checkout.cache.join("scratch");
    if scratch.exists() {
        std::fs::remove_dir_all(&scratch)
            .context("could not clear the last run's scratch files")?;
    }
    let runner_home = checkout.cache.join("runner-home");
    for directory in [&scratch, &runner_home] {
        std::fs::create_dir_all(directory)
            .context(format!("could not create {}", directory.display()))?;
    }

    let fresh_checkout = || checkout.restore();
    let machine = Machine {
        manifest: &manifest,
        workspace: checkout.dir.clone(),
        scratch,
        runner_home,
        github: BTreeMap::from([
            ("workspace", checkout.dir.display().to_string()),
            ("sha", checkout.merge.clone()),
            ("event_name", "pull_request".to_owned()),
            ("base_ref", checkout.base_branch.clone()),
            ("repository", checkout.repository.clone()),
        ]),
        changed_files: checkout.changed_files.clone(),
        shallow: checkout.shallow,
        fresh_checkout: &fresh_checkout,
    };

    let caller = load(&checkout.dir, &manifest.caller)?;
    let start = match machine.run_job(
        &caller,
        &manifest.caller_start_job,
        &Plan::FiltersOnly,
        &BTreeMap::new(),
    )? {
        JobResult::Passed(outputs) => outputs,
        JobResult::Failed { step } => bail!("deciding the caller's path filters ran `{step}`"),
        JobResult::Unavailable(why) => bail!("the caller's path filters can't be decided: {why}"),
    };
    let mut session = Session {
        machine,
        caller,
        caller_needs: BTreeMap::from([(manifest.caller_start_job.clone(), start)]),
        selections: BTreeMap::new(),
        base: checkout.base.clone(),
    };

    // A pass posted for this commit earlier no longer holds for a check that
    // fails now.
    let posted = if post_statuses {
        Some(github::newest_statuses(
            &checkout.repository,
            &checkout.head,
        )?)
    } else {
        None
    };

    // Each check is settled as it ends: a later check that stops the run must
    // not leave a failed check's earlier pass in force.
    let mut all_passed = true;
    let mut summary = Vec::new();
    for check in checks {
        let verdict = session.run(check)?;
        all_passed &= !matches!(verdict, Verdict::Failed { .. });
        let line = settle(&checkout, &manifest, posted.as_ref(), check, &verdict)?;
        eprintln!("{line}");
        summary.push(line);
    }

    println!();
    for line in summary {
        println!("{line}");
    }
    Ok(all_passed)
}

fn main() -> ExitCode {
    let outcome = match Cli::parse().command {
        Action::List => list().map(|()| true),
        Action::Run { checks, post, base } => run(&checks, post, &base),
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
