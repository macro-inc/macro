//! `.github/attestable-checks.json`: the `PR CI` jobs that can be attested,
//! with the scripts a runner runs for each. Written by `cargo x workflows`
//! (`xtask_workflows`' `attestation` module).

use std::collections::BTreeMap;

use rootcause::prelude::*;
use serde::Deserialize;

pub const PATH: &str = ".github/attestable-checks.json";

#[derive(Deserialize)]
pub struct Manifest {
    /// A check's commit status is this plus its id.
    pub status_prefix: String,
    pub checks: Vec<Check>,
    /// The jobs `PR CI` runs that can't be attested.
    pub not_attestable: Vec<NotAttestable>,
}

#[derive(Deserialize)]
pub struct Check {
    /// `<call>/<job>`.
    pub id: String,
    /// The job's name in a `PR CI` run.
    pub name: String,
    /// What a pass was for; a status for another fingerprint is not accepted.
    pub fingerprint: String,
    /// The paths whose change makes `PR CI` run the job; `.` is any path.
    pub triggers: Vec<String>,
    /// The Nix dev shell its steps run in.
    pub dev_shell: String,
    pub env: BTreeMap<String, String>,
    pub steps: Vec<Step>,
}

/// One script of a check, as the workflow holds it.
#[derive(Deserialize)]
pub struct Step {
    pub name: String,
    pub run: String,
    /// Relative to the repository's root.
    pub working_directory: Option<String>,
    /// Whether a runner runs it with `-o pipefail`.
    pub pipefail: bool,
    pub env: BTreeMap<String, String>,
}

#[derive(Deserialize)]
pub struct NotAttestable {
    pub id: String,
    pub why: String,
}

impl Manifest {
    pub fn parse(text: &str) -> Result<Self, Report> {
        Ok(serde_json::from_str(text).context(format!(
            "{PATH} is not what this cargo x attest reads; run `cargo x workflows`"
        ))?)
    }

    pub fn check(&self, id: &str) -> Option<&Check> {
        self.checks.iter().find(|check| check.id == id)
    }
}
