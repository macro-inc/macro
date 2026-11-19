//! `.github/attestable-checks.json`: the `PR CI` jobs that can be attested,
//! written by `cargo x workflows` (`xtask_workflows`' `attestation` module).

use std::path::Path;

use rootcause::prelude::*;
use serde::Deserialize;

const PATH: &str = ".github/attestable-checks.json";

#[derive(Deserialize)]
pub struct Manifest {
    /// A check's commit status is this plus its id.
    pub status_prefix: String,
    /// The workflow that calls the checks' workflows, and its job whose path
    /// filters decide which calls run.
    pub caller: String,
    pub caller_start_job: String,
    /// The job whose outputs select what a called workflow's jobs run on.
    pub selector_job: String,
    /// The action that turns changed paths into outputs; emulated here.
    pub filter_action: String,
    /// `run` steps and actions that only keep a runner going; skipped here.
    pub runner_steps: Vec<String>,
    pub runner_actions: Vec<String>,
    pub checks: Vec<Check>,
}

#[derive(Clone, Deserialize)]
pub struct Check {
    /// `<call>/<job>`.
    pub id: String,
    /// The caller's job that calls the workflow.
    pub call: String,
    pub workflow: String,
    pub job: String,
    /// The job's own condition.
    #[serde(rename = "if")]
    pub condition: Option<String>,
    /// The selector outputs the job reads, sorted.
    pub inputs: Vec<String>,
    /// Whether the job waits for the selector job.
    pub selected: bool,
    /// The `run` steps that are the check.
    pub steps: Vec<String>,
    pub fingerprint: String,
}

impl Manifest {
    /// The manifest of the tree checked out at `root`.
    pub fn read(root: &Path) -> Result<Self, Report> {
        let path = root.join(PATH);
        let text =
            std::fs::read_to_string(&path).context(format!("could not read {}", path.display()))?;
        Ok(serde_json::from_str(&text).context(format!("{PATH} is not a check manifest"))?)
    }
}
