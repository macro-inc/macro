//! `cargo x attest`: run `PR CI` jobs on this machine and attest the result.
//!
//! `cargo x attest run <check>...` builds the merge of `HEAD` with `main`,
//! runs each check's job there as a runner would ([`runner`]), and with
//! `--post` records every pass as a commit status on `HEAD`. A requested
//! `PR CI` run then skips those jobs (`xtask_workflows`' `attestation`
//! module has the rules). Without `--post` nothing leaves the machine.
//!
//! A check that fails here posts nothing: its job simply runs in `PR CI`.

mod checkout;
mod expression;
mod file_commands;
mod manifest;
mod paths_filter;
mod runner;

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::{Command, ExitCode},
};

use clap::{Parser, Subcommand};
use rootcause::prelude::*;

use crate::{
    checkout::Checkout,
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
    checkout: &'a Checkout,
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
        let call_condition = self.caller["jobs"][check.call.as_str()]["if"].as_str();
        if !self.condition(call_condition, &self.caller_needs)? {
            return Ok(Verdict::NotNeeded);
        }

        let workflow = load(&self.machine.workspace, &check.workflow)?;
        let selector = self.machine.manifest.selector_job.clone();

        let mut needs = BTreeMap::new();
        if check.selected {
            if !self.selections.contains_key(&check.workflow) {
                eprintln!("── {} / {selector}", check.workflow);
                self.checkout.restore()?;
                let selection = match self.machine.run_job(
                    &workflow,
                    &selector,
                    &Plan::EveryStep,
                    &BTreeMap::new(),
                )? {
                    JobResult::Passed(outputs) => Some(outputs),
                    JobResult::Failed { .. } => None,
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
        self.checkout.restore()?;
        match self
            .machine
            .run_job(&workflow, &check.job, &Plan::Steps(&check.steps), &needs)?
        {
            JobResult::Failed { step } => Ok(Verdict::Failed { step }),
            JobResult::Passed(_) => {
                let digest = match needs.values().next() {
                    Some(selection) => runner::inputs_digest(&check.inputs, selection),
                    None => "-".to_owned(),
                };
                Ok(Verdict::Passed {
                    description: format!(
                        "fp={} in={digest} base={}",
                        check.fingerprint,
                        &self.base[..7]
                    ),
                })
            }
        }
    }
}

fn post(checkout: &Checkout, context: &str, description: &str) -> Result<(), Report> {
    let output = Command::new("gh")
        .args(["api", "--method", "POST"])
        .arg(format!(
            "repos/{}/statuses/{}",
            checkout.repository, checkout.head
        ))
        .args(["-f", "state=success"])
        .args(["-f", &format!("context={context}")])
        .args(["-f", &format!("description={description}")])
        .output()
        .context("could not run gh")?;
    if !output.status.success() {
        bail!(
            "could not post {context} on {}: {}\nis the commit pushed?",
            &checkout.head[..10],
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn run(asked: &[String], post_statuses: bool, base_branch: &str) -> Result<bool, Report> {
    let checkout = checkout::prepare(&source_root()?, base_branch)?;
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
    };
    let mut session = Session {
        checkout: &checkout,
        machine,
        caller,
        caller_needs: BTreeMap::from([(manifest.caller_start_job.clone(), start)]),
        selections: BTreeMap::new(),
        base: checkout.base.clone(),
    };

    let mut verdicts = Vec::new();
    for check in checks {
        verdicts.push((check, session.run(check)?));
    }

    println!();
    let mut all_passed = true;
    for (check, verdict) in &verdicts {
        match verdict {
            Verdict::NotNeeded => {
                println!("-     {}: PR CI does not run it for this change", check.id)
            }
            Verdict::Failed { step } => {
                all_passed = false;
                println!(
                    "FAIL  {}: `{step}` failed; its job will run in PR CI",
                    check.id
                );
            }
            Verdict::Passed { description } => {
                let context = format!("{}{}", manifest.status_prefix, check.id);
                if post_statuses {
                    post(&checkout, &context, description)?;
                    println!(
                        "pass  {}: posted {context} on {}",
                        check.id,
                        &checkout.head[..10]
                    );
                } else {
                    println!(
                        "pass  {}: would post {context} \"{description}\" (--post)",
                        check.id
                    );
                }
            }
        }
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
