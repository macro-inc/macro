//! Attested checks: `PR CI` jobs a developer may run on their own machine
//! instead of on a runner.
//!
//! `cargo x attest` (`xtask_attest`) runs a job's own steps on the pull
//! request's merge with `main` and, when they pass, posts a commit status
//! named [`STATUS_PREFIX`] plus the check's id on the PR head. `PR CI`'s
//! `Start` reads those statuses and hands the accepted ones to the workflows
//! it calls, where each attested job is skipped. A job with no attestation
//! runs as before.
//!
//! An attestation is accepted only for the job it ran, on the tree it ran on:
//!
//! - its `base` is the commit of `main` in the merge commit this run tests.
//!   With the head the status sits on, that fixes the tree;
//! - its `fp` is the [`fingerprint`] of the job as this tree defines it, so a
//!   job that changed since (here or on `main`) runs on a runner;
//! - its `in` is a digest of the `path-check` outputs the job reads, compared
//!   by `path-check` itself ([`ACCEPT_STEP`]), so tests attested for one set of
//!   packages are never skipped for another.
//!
//! One request in [`AUDIT_ONE_IN`] ignores every attestation and runs every
//! job the change selects, and the gate names an attested check that failed
//! there. Nothing else runs these jobs for a pull request, so that is the only
//! independent check of what a machine attested. An audit marks the commit
//! with the [`AUDIT_CONTEXT`] status and every later run on it is an audit
//! too, so a failed one can't be requested again into a pass.
//!
//! A check is a job listed in [`CHECKS`] with the steps that are the check.
//! Every other step of the job must be runner upkeep ([`RUNNER_STEPS`],
//! [`RUNNER_ACTIONS`]): the tests fail on a step nobody classified. The
//! generator writes what `cargo x attest` needs to [`MANIFEST_FILE`].

use anyhow::{Context, Result};
use lazy_regex::regex;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::workflows::{pr_ci, steps};

#[cfg(test)]
mod test;

/// The commit status of an attested check is this plus the check's id.
pub const STATUS_PREFIX: &str = "attested/";

/// One requested run in this many runs the attested jobs on runners too.
pub const AUDIT_ONE_IN: u32 = 10;

/// The commit status an audit leaves on the head: later runs on that commit
/// are audits too.
pub const AUDIT_CONTEXT: &str = "attestation audit";

/// Written next to the workflows; read by `cargo x attest`.
pub const MANIFEST_FILE: &str = "attestable-checks.json";

/// The job whose outputs decide which jobs run and on what.
const SELECTOR_JOB: &str = "path-check";

/// The `path-check` step that accepts attestations for this run's selection.
const ACCEPT_STEP: &str = "Accept attested checks";

/// `run` steps that keep a runner's caches and never decide a check's result.
pub const RUNNER_STEPS: &[&str] = &[
    "Prepare the blobless checkout",
    "Reuse the kept cargo target",
    "Seal the kept cargo target",
    "Configure Namespace remote sccache",
    "Start sccache server",
    "show sccache stats",
    ACCEPT_STEP,
];

/// Actions that prepare a runner. `cargo x attest` runs in the repository's
/// dev shell instead, which pins the same tools.
pub const RUNNER_ACTIONS: &[&str] = &[
    "actions/checkout",
    "actions/setup-node",
    "oven-sh/setup-bun",
    "namespacelabs/nscloud-cache-action",
    "runs-on/cache/restore",
    "runs-on/cache/save",
    "./.github/actions/setup-nix",
    "./.github/actions/setup-nix-dev-shell",
    "./.github/actions/setup-rust",
    "./.github/actions/setup-sccache",
    "./.github/actions/teardown-nix",
];

/// The action `cargo x attest` emulates: it decides outputs from changed paths.
pub const FILTER_ACTION: &str = "dorny/paths-filter";

/// A `PR CI` job that can be attested.
pub struct Check {
    /// The `PR CI` call the job runs under ([`pr_ci::CALLS`]).
    pub call: &'static str,
    /// The job's id in the called workflow.
    pub job: &'static str,
    /// The `run` steps that are the check, by name.
    pub steps: &'static [&'static str],
}

impl Check {
    /// `<call>/<job>`: `web-app/test`.
    pub fn id(&self) -> String {
        format!("{}/{}", self.call, self.job)
    }
}

/// Every job that can be attested. A job is left out when a developer's
/// machine can't run it as the runner does: it needs a secret
/// (`doppler-config`, the web `build` and its preview), service containers
/// (the Rust `test`), system packages (`functional`, `browser`), another
/// operating system, or the pull request's labels and store state (the native
/// checks). So is a job another job needs: skipping it would skip that job
/// too.
pub const CHECKS: &[Check] = &[
    Check {
        call: "cloud-storage",
        job: "check",
        steps: &[
            "Build code-mode assets",
            "fmt",
            "unused dependencies",
            "clippy",
        ],
    },
    Check {
        call: "cloud-storage",
        job: "build-service-bins",
        steps: &["Build code-mode assets", "build service binaries"],
    },
    Check {
        call: "cloud-storage",
        job: "graphql-schema-compat",
        steps: &["Check GraphQL schema compatibility"],
    },
    Check {
        call: "web-app",
        job: "typescript",
        steps: &[
            "Install SDK Documentation Dependencies",
            "Build SDK",
            "Run checks",
        ],
    },
    Check {
        call: "web-app",
        job: "generated-code",
        steps: &[
            "Build code-mode assets",
            "Build schema binaries",
            "Generate API Types",
            "Regenerate SDK code",
            "Verify SDK generated code is fresh",
            "Check Specta Types",
        ],
    },
    Check {
        call: "web-app",
        job: "biome-check",
        steps: &[
            "Run Biome",
            "Run Collaboration Package Biome",
            "Check Browser Floor and Native Permissions",
        ],
    },
    Check {
        call: "web-app",
        job: "test",
        steps: &[
            "Build agent-fold WASM for tests",
            "Build natural-time WASM for tests",
            "Test",
        ],
    },
    Check {
        call: "web-app",
        job: "cycles",
        steps: &[
            "Cycles Import Check",
            "Collaboration Package Cycles Import Check",
        ],
    },
    Check {
        call: "infra",
        job: "biome-check",
        steps: &["Run Biome"],
    },
    Check {
        call: "infra",
        job: "check",
        steps: &["install", "check"],
    },
    Check {
        call: "conventions",
        job: "ast-grep",
        steps: &["Run ast-grep"],
    },
    Check {
        call: "cargo-deny",
        job: "cargo-deny",
        steps: &[
            "Install cargo-deny",
            "cargo deny check bans licenses sources",
            "cargo deny check advisories, for packages this PR adds",
        ],
    },
    Check {
        call: "workspace-dependencies",
        job: "dependency-check",
        steps: &["install tool", "check"],
    },
    Check {
        call: "workspace-dependencies",
        job: "hakari-and-dep-closures",
        steps: &["generated dependency artifacts are up to date"],
    },
    Check {
        call: "generated-workflows",
        job: "check-workflows",
        steps: &[
            "verify workflows are up to date",
            "verify kafka cluster topics are up to date",
        ],
    },
    Check {
        call: "node-modules-nix",
        job: "check-linux-node-modules-nix",
        steps: &["verify js node_modules derivation is up to date"],
    },
    Check {
        call: "sdk",
        job: "check-package",
        steps: &[
            "Install dependencies",
            "Typecheck SDK",
            "Test SDK",
            "Check endpoint coverage",
            "Check packed SDK",
        ],
    },
    Check {
        call: "observability-image",
        job: "build-image",
        steps: &["Build the NixOS image"],
    },
    Check {
        call: "macrod-update",
        job: "linux",
        steps: &[
            "Build two tagged releases",
            "Self-update end to end",
            "Installer in bash, zsh and fish",
        ],
    },
];

/// A check as `PR CI` and `cargo x attest` need it.
pub struct Described {
    pub id: String,
    pub call: &'static str,
    /// The called workflow's file.
    pub workflow: &'static str,
    pub job: &'static str,
    /// The job's name in a `PR CI` run: `Web App / Typecheck`. A matrix job's
    /// name stops where its matrix value starts.
    pub name: String,
    pub matrix: bool,
    /// The job's own condition, before the attestation clause.
    pub condition: Option<String>,
    /// The `path-check` outputs the job reads, sorted.
    pub inputs: Vec<String>,
    /// Whether `path-check` selects the job, so an attestation carries a digest.
    pub selected: bool,
    pub steps: &'static [&'static str],
    pub fingerprint: String,
}

fn checks_of(file_name: &str) -> impl Iterator<Item = &'static Check> {
    CHECKS
        .iter()
        .filter(move |check| call_of(check).is_some_and(|call| call.file == file_name))
}

fn call_of(check: &Check) -> Option<&'static pr_ci::Call> {
    pr_ci::CALLS.iter().find(|call| call.id == check.call)
}

/// Whether `PR CI` hands this called workflow its attestations.
pub fn calls_attested(call: &pr_ci::Call) -> bool {
    checks_of(call.file).next().is_some()
}

fn job<'a>(
    root: &'a serde_yaml::Value,
    id: &str,
    file_name: &str,
) -> Result<&'a serde_yaml::Value> {
    root.get("jobs")
        .and_then(|jobs| jobs.get(id))
        .with_context(|| format!("{file_name} has no job `{id}`"))
}

/// Whether the job waits for `path-check`.
fn is_selected(job: &serde_yaml::Value) -> bool {
    job["needs"]
        .as_sequence()
        .is_some_and(|needs| needs.iter().any(|need| need.as_str() == Some(SELECTOR_JOB)))
}

/// The `path-check` outputs a job reads, anywhere in its definition.
fn inputs_of(job: &serde_yaml::Value) -> Result<Vec<String>> {
    let text = serde_yaml::to_string(job).context("serializing a job")?;

    let mut names: Vec<String> = regex!(r"needs\.path-check\.outputs\.([a-z_]+)")
        .captures_iter(&text)
        .map(|capture| capture[1].to_owned())
        .filter(|name| name != "attested")
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

/// What an attestation entry looks like where the job's condition reads it.
fn skip_clause(id: &str, selected: bool) -> String {
    if selected {
        format!("!contains(fromJSON(needs.{SELECTOR_JOB}.outputs.attested || '[]'), '{id}')")
    } else {
        format!("!contains(fromJSON(inputs.attested || '[]'), '{id}@-')")
    }
}

/// Make the attested jobs of a called workflow skippable: declare the
/// `attested` input, have `path-check` accept the entries that match this
/// run's selection, and add the skip clause to each job's condition. Other
/// workflows come back unchanged.
pub fn patch(file_name: &str, yaml: String) -> Result<String> {
    let checks: Vec<&Check> = checks_of(file_name).collect();
    if checks.is_empty() {
        return Ok(yaml);
    }

    let mut root: serde_yaml::Value =
        serde_yaml::from_str(&yaml).with_context(|| format!("re-parsing {file_name}"))?;

    let call = root
        .get_mut("on")
        .and_then(|on| on.get_mut("workflow_call"))
        .and_then(serde_yaml::Value::as_mapping_mut)
        .with_context(|| format!("{file_name} has no workflow_call trigger"))?;
    call.insert(
        "inputs".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            attested:
              description: 'JSON list of the attested checks PR CI accepted: `<check>@<digest of the path-check outputs it ran on>`'
              type: string
              required: false
              default: '[]'
        "#})?,
    );

    let mut selected_inputs: Vec<(String, Vec<String>)> = Vec::new();
    for check in &checks {
        let definition = job(&root, check.job, file_name)?;
        let selected = is_selected(definition);
        if selected {
            selected_inputs.push((check.id(), inputs_of(definition)?));
        }

        let clause = skip_clause(&check.id(), selected);
        let job = crate::workflows::job_mut(&mut root, check.job)?;
        let condition = match job.get("if").and_then(serde_yaml::Value::as_str) {
            Some(own) => format!("({own}) && {clause}"),
            None => clause,
        };
        job.insert("if".into(), condition.into());
    }

    if !selected_inputs.is_empty() {
        accept_in_selector(&mut root, &selected_inputs)?;
    }

    serde_yaml::to_string(&root).with_context(|| format!("serializing {file_name}"))
}

/// Add [`ACCEPT_STEP`] and its output to `path-check`. The step hashes, for
/// each check, the outputs that check reads and accepts the attestation that
/// carries the same digest.
fn accept_in_selector(
    root: &mut serde_yaml::Value,
    checks: &[(String, Vec<String>)],
) -> Result<()> {
    let selector = crate::workflows::job_mut(root, SELECTOR_JOB)?;
    let outputs = selector
        .get("outputs")
        .and_then(serde_yaml::Value::as_mapping)
        .cloned()
        .context("path-check has no outputs")?;

    let mut env = serde_yaml::Mapping::new();
    env.insert("ATTESTED".into(), "${{ inputs.attested }}".into());
    let check_inputs: serde_json::Map<String, serde_json::Value> = checks
        .iter()
        .map(|(id, inputs)| (id.clone(), json!(inputs)))
        .collect();
    env.insert(
        "CHECK_INPUTS".into(),
        serde_json::to_string(&check_inputs)?.into(),
    );

    let mut names: Vec<&String> = checks.iter().flat_map(|(_, inputs)| inputs).collect();
    names.sort();
    names.dedup();
    for name in names {
        let value = outputs
            .get(name.as_str())
            .with_context(|| format!("path-check has no output `{name}`"))?;
        env.insert(format!("OUTPUT_{name}").into(), value.clone());
    }

    let mut step = serde_yaml::Mapping::new();
    step.insert("id".into(), "attested".into());
    step.insert("name".into(), ACCEPT_STEP.into());
    step.insert(
        "if".into(),
        "inputs.attested != '' && inputs.attested != '[]'".into(),
    );
    step.insert(
        "run".into(),
        steps::node_script(include_str!("scripts/accept_attested_checks.ts")).into(),
    );
    step.insert("shell".into(), "bash".into());
    step.insert("env".into(), env.into());

    selector
        .get_mut("steps")
        .and_then(serde_yaml::Value::as_sequence_mut)
        .context("path-check has no steps")?
        .push(step.into());
    selector
        .get_mut("outputs")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .context("path-check has no outputs")?
        .insert(
            "attested".into(),
            "${{ steps.attested.outputs.attested }}".into(),
        );
    Ok(())
}

/// The workflow a call runs: as its module builds it, or as generated.
fn rendered(file_name: &str, patched: bool) -> Result<serde_yaml::Value> {
    let workflow = crate::workflows::WORKFLOWS
        .iter()
        .find(|workflow| workflow.file_name == file_name)
        .with_context(|| format!("{file_name} is not a generated workflow"))?;
    let own = (workflow.render_yaml)()?;
    let yaml = if patched { patch(file_name, own)? } else { own };
    serde_yaml::from_str(&yaml).with_context(|| format!("parsing {file_name}"))
}

/// What identifies the job an attestation ran: the job, the `path-check` it
/// reads, the workflow's environment, and the steps that are the check.
fn fingerprint(root: &serde_yaml::Value, check: &Check, selected: bool) -> Result<String> {
    let identity = json!({
        "job": serde_json::to_value(&root["jobs"][check.job])?,
        "selector": if selected {
            serde_json::to_value(&root["jobs"][SELECTOR_JOB])?
        } else {
            serde_json::Value::Null
        },
        "env": serde_json::to_value(&root["env"])?,
        "steps": check.steps,
    });
    let digest = Sha256::digest(serde_json::to_string(&identity)?);
    Ok(hex::encode(&digest[..8]))
}

/// Every check, read from the workflows as generated.
pub fn described() -> Result<Vec<Described>> {
    CHECKS
        .iter()
        .map(|check| {
            let call =
                call_of(check).with_context(|| format!("PR CI has no call `{}`", check.call))?;
            let root = rendered(call.file, true)?;
            let definition = job(&root, check.job, call.file)?;
            let selected = is_selected(definition);

            let own_name = definition["name"].as_str().unwrap_or(check.job);
            let (name, matrix) = match own_name.split_once("${{") {
                Some((before, _)) => (before, true),
                None => (own_name, false),
            };

            // The condition `cargo x attest` evaluates is the job's own: the
            // attestation clause is about the run, not about the job.
            let own = rendered(call.file, false)?;
            let condition = job(&own, check.job, call.file)?["if"]
                .as_str()
                .map(str::to_owned);

            Ok(Described {
                id: check.id(),
                call: check.call,
                workflow: call.file,
                job: check.job,
                name: format!("{} / {name}", call.name),
                matrix,
                condition,
                inputs: inputs_of(definition)?,
                selected,
                steps: check.steps,
                fingerprint: fingerprint(&root, check, selected)?,
            })
        })
        .collect()
}

/// [`MANIFEST_FILE`]'s contents.
pub fn manifest() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| {
            json!({
                "id": check.id,
                "call": check.call,
                "workflow": check.workflow,
                "job": check.job,
                "if": check.condition,
                "inputs": check.inputs,
                "selected": check.selected,
                "steps": check.steps,
                "fingerprint": check.fingerprint,
            })
        })
        .collect();

    let manifest = json!({
        "comment": "Generated by `cargo x workflows`; do not edit. The PR CI jobs `cargo x attest` can run.",
        "status_prefix": STATUS_PREFIX,
        "caller": pr_ci::FILE,
        "caller_start_job": pr_ci::START_ID,
        "selector_job": SELECTOR_JOB,
        "filter_action": FILTER_ACTION,
        "runner_steps": RUNNER_STEPS,
        "runner_actions": RUNNER_ACTIONS,
        "checks": checks,
    });
    Ok(format!("{}\n", serde_json::to_string_pretty(&manifest)?))
}

/// What `Start` needs to accept a status: the check, its fingerprint, and
/// whether its attestation carries a digest.
pub fn start_checks() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| {
            json!({
                "id": check.id,
                "fingerprint": check.fingerprint,
                "selected": check.selected,
            })
        })
        .collect();
    Ok(serde_json::to_string(&checks)?)
}

/// What the gate needs to find a check's jobs in the finished run.
pub fn gate_checks() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| json!({ "id": check.id, "name": check.name, "matrix": check.matrix }))
        .collect();
    Ok(serde_json::to_string(&checks)?)
}
