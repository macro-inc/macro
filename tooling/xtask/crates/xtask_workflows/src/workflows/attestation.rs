//! Attested checks: `PR CI` jobs whose pass on a developer's machine counts.
//!
//! Each job `PR CI` runs is declared here once: in [`CHECKS`] with the steps
//! that are the check, or in [`NOT_ATTESTABLE`] with the reason. From a check
//! the generator derives everything else:
//!
//! - the scripts a machine runs. They are the job's own `run` steps, copied
//!   into [`MANIFEST_FILE`] as generated, so a runner and `cargo x attest`
//!   (`xtask_attest`) execute the same text. A step that needs more than a
//!   shell (a condition, an expression, an action) fails generation instead of
//!   being imitated;
//! - what `Start` and the gate need. The job itself says it can be skipped:
//!   its condition ends with [`not_attested`] and its workflow declares the
//!   input with [`takes_attestations`]; generation fails when a listed job
//!   lacks either;
//! - the paths whose change makes `PR CI` run the job ([`triggers`]), which
//!   tell a machine which checks a branch needs.
//!
//! A pass is recorded for a tree. `cargo x attest` runs a check in the
//! working tree and posts a commit status named [`STATUS_PREFIX`] plus the
//! check's id that carries the tree it ran on (`tree`) and the check's
//! [`fingerprint`] (`fp`). `Start` accepts a status that names the tree of
//! the merge commit it tests. So a pass counts exactly when `PR CI` would
//! test the files the machine tested, and never for a tree that `main` or a
//! later commit has changed.
//!
//! The whole tree, not the paths a job is triggered by: those paths say when a
//! pull request needs the job, not everything the job reads. A check's pass
//! on its own paths would outlive a change to a dependency outside them.
//!
//! A machine always runs the whole check: where a runner would lint the
//! packages a pull request touches, a machine lints them all
//! ([`Check::local_env`]). A pass therefore covers whatever a run selects.
//!
//! Each accepted check has one chance in [`AUDIT_ONE_IN`] of running on a
//! runner anyway. Nothing else runs these jobs for a pull request, so that is
//! the only independent check of what a machine attested. A check that fails
//! there is withdrawn for the tree it failed on.

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use gh_workflow::expr::typed::{Bool, Expr, Json, Str, from_json, input};
use gh_workflow::{WorkflowCall, WorkflowInput};
use lazy_regex::regex;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::workflows::pr_ci;

#[cfg(test)]
mod test;

/// The commit status of an attested check is this plus the check's id.
pub const STATUS_PREFIX: &str = "attested/";

/// An accepted check runs on a runner anyway in one request out of this many.
pub const AUDIT_ONE_IN: u32 = 10;

/// The input a called workflow takes: a JSON list of the checks `PR CI`
/// accepted an attestation for, by id.
pub const INPUT: &str = "attested";

/// Written next to the workflows; read by `cargo x attest`.
pub const MANIFEST_FILE: &str = "attestable-checks.json";

/// The job whose outputs decide which jobs run and on what.
const SELECTOR_JOB: &str = "path-check";

/// The action a selector job decides its outputs with.
const FILTER_ACTION: &str = "dorny/paths-filter";

/// The action that enters a dev shell; its `shell` input names which. A job
/// without it runs on a machine in the default one, which holds the tools the
/// job's other setup actions install.
const DEV_SHELL_ACTION: &str = "./.github/actions/setup-nix-dev-shell";
const DEFAULT_DEV_SHELL: &str = "default";

/// Where a runner keeps its caches; a machine has no such directory.
const RUNNER_HOME: &str = "/home/runner";

/// `run` steps that keep a runner's caches and never decide a check's result.
pub const RUNNER_STEPS: &[&str] = &[
    "Prepare the blobless checkout",
    "Reuse the kept cargo target",
    "Seal the kept cargo target",
    "Configure Namespace remote sccache",
    "Start sccache server",
    "show sccache stats",
];

/// Actions that prepare a runner and change nothing a check reads. A machine
/// runs in the repository's dev shell, which pins the same tools. An action
/// that is not one of these makes its job [`NOT_ATTESTABLE`].
pub const RUNNER_ACTIONS: &[&str] = &[
    "actions/checkout",
    "actions/setup-node",
    "oven-sh/setup-bun",
    "namespacelabs/nscloud-cache-action",
    "./.github/actions/setup-nix",
    "./.github/actions/setup-nix-dev-shell",
    "./.github/actions/setup-rust",
    "./.github/actions/teardown-nix",
];

/// A `PR CI` job that can be attested.
pub struct Check {
    /// The `PR CI` call the job runs under ([`pr_ci::CALLS`]).
    pub call: &'static str,
    /// The job's id in the called workflow.
    pub job: &'static str,
    /// The `run` steps that are the check, by name.
    pub steps: &'static [&'static str],
    /// What a machine sets for the variables a runner computes from the pull
    /// request (`${{ … }}`). It must be the widest choice a run can make, so
    /// that a pass on a machine covers every run.
    pub local_env: &'static [(&'static str, &'static str)],
}

impl Check {
    /// `<call>/<job>`: `web-app/cycles`.
    pub fn id(&self) -> String {
        format!("{}/{}", self.call, self.job)
    }
}

/// A `PR CI` job a machine's pass can't stand in for, and why.
pub struct NotAttestable {
    pub call: &'static str,
    pub job: &'static str,
    pub why: &'static str,
}

/// The Rust jobs lint or build the packages a pull request touches; a machine
/// takes them all. The kept cargo target of a runner is rebuilt when query
/// data changes; a machine has no kept target to rebuild.
const EVERY_RUST_PACKAGE: &[(&str, &str)] =
    &[("RUST_PACKAGES", "all"), ("CARGO_TARGET_REBUILD_ALL", "")];

/// Every job that can be attested: its steps are plain scripts that leave
/// tracked files as they are, it runs on Linux with nothing but the dev
/// shell, and the tree alone decides its verdict.
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
        local_env: EVERY_RUST_PACKAGE,
    },
    Check {
        call: "cloud-storage",
        job: "build-service-bins",
        steps: &["Build code-mode assets", "build service binaries"],
        local_env: EVERY_RUST_PACKAGE,
    },
    Check {
        call: "infra",
        job: "check",
        steps: &["install", "check"],
        local_env: &[],
    },
    Check {
        call: "conventions",
        job: "ast-grep",
        steps: &["Run ast-grep"],
        local_env: &[],
    },
    Check {
        call: "workspace-dependencies",
        job: "hakari-and-dep-closures",
        steps: &["generated dependency artifacts are up to date"],
        local_env: &[],
    },
    Check {
        call: "generated-workflows",
        job: "check-workflows",
        steps: &[
            "verify workflows are up to date",
            "verify kafka cluster topics are up to date",
        ],
        local_env: &[],
    },
    Check {
        call: "generated-workflows",
        job: "lint-workflows",
        steps: &["actionlint", "zizmor"],
        local_env: &[],
    },
    Check {
        call: "node-modules-nix",
        job: "check-linux-node-modules-nix",
        steps: &["verify js node_modules derivation is up to date"],
        local_env: &[],
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
        local_env: &[],
    },
    Check {
        call: "observability-image",
        job: "build-image",
        steps: &["Build the NixOS image"],
        local_env: &[],
    },
    Check {
        call: "macrod-update",
        job: "linux",
        steps: &[
            "Build two tagged releases",
            "Self-update end to end",
            "Installer in bash, zsh and fish",
        ],
        local_env: &[],
    },
];

const SELECTS: &str = "decides what the other jobs run, and they wait for it";
const WEB_SETUP: &str =
    "its setup rewrites `bunfig.toml` and replaces `node_modules`, which a working tree can't take";
const OTHER_SYSTEM: &str = "runs on another operating system";
const CHANGED_FILES_ONLY: &str =
    "lints the files changed since `main`, so a ref outside the tree decides what it checks";
const PULL_REQUEST_STATE: &str = "reads the pull request's labels and the app stores' state";

/// Every other job `PR CI` runs. The tests hold the two lists to the jobs
/// that exist, so a new job is in neither until someone decides.
pub const NOT_ATTESTABLE: &[NotAttestable] = &[
    NotAttestable {
        call: "cloud-storage",
        job: "path-check",
        why: SELECTS,
    },
    NotAttestable {
        call: "cloud-storage",
        job: "test",
        why: "needs service containers on fixed ports",
    },
    NotAttestable {
        call: "cloud-storage",
        job: "doppler-config",
        why: "reads secrets",
    },
    NotAttestable {
        call: "cloud-storage",
        job: "graphql-schema-compat",
        why: "compares the schema with the base of the merge commit (`HEAD^1`), which a working tree does not have",
    },
    NotAttestable {
        call: "web-app",
        job: "path-check",
        why: SELECTS,
    },
    NotAttestable {
        call: "web-app",
        job: "typescript",
        why: WEB_SETUP,
    },
    NotAttestable {
        call: "web-app",
        job: "generated-code",
        why: WEB_SETUP,
    },
    NotAttestable {
        call: "web-app",
        job: "test",
        why: WEB_SETUP,
    },
    NotAttestable {
        call: "web-app",
        job: "biome-check",
        why: CHANGED_FILES_ONLY,
    },
    NotAttestable {
        call: "web-app",
        job: "cycles",
        why: CHANGED_FILES_ONLY,
    },
    NotAttestable {
        call: "web-app",
        job: "build",
        why: "reads secrets and deploys a preview",
    },
    NotAttestable {
        call: "web-app",
        job: "functional",
        why: "needs browsers and system packages a dev shell does not install",
    },
    NotAttestable {
        call: "web-app",
        job: "browser",
        why: "needs browsers and system packages a dev shell does not install",
    },
    NotAttestable {
        call: "web-app",
        job: "android-native-check",
        why: PULL_REQUEST_STATE,
    },
    NotAttestable {
        call: "web-app",
        job: "ios-native-check",
        why: PULL_REQUEST_STATE,
    },
    NotAttestable {
        call: "infra",
        job: "biome-check",
        why: CHANGED_FILES_ONLY,
    },
    NotAttestable {
        call: "cargo-deny",
        job: "cargo-deny",
        why: "reads the advisory database of the day it runs, so the tree alone does not decide its verdict",
    },
    NotAttestable {
        call: "workspace-dependencies",
        job: "dependency-check",
        why: "its script edits `Cargo.toml` in place, which a working tree can't take",
    },
    NotAttestable {
        call: "node-modules-nix",
        job: "check-darwin-node-modules-nix",
        why: OTHER_SYSTEM,
    },
    NotAttestable {
        call: "tauri-lockfiles",
        job: "check-tauri-lockfiles",
        why: SELECTS,
    },
    NotAttestable {
        call: "tauri-lockfiles",
        job: "check-tauri-vendoring",
        why: "waits for `check-tauri-lockfiles`, which decides whether it runs",
    },
    NotAttestable {
        call: "observability-aws",
        job: "validate",
        why: "validates OpenTofu through the AWS layer's separate Nix flake on CI",
    },
    NotAttestable {
        call: "observability-cluster",
        job: "check-manifests",
        why: "renders Helm charts and validates manifests through the cluster's separate Nix flake on CI",
    },
    NotAttestable {
        call: "macrod-update",
        job: "macos",
        why: OTHER_SYSTEM,
    },
    NotAttestable {
        call: "macrod-update",
        job: "windows",
        why: OTHER_SYSTEM,
    },
];

/// One script of a check, as a runner and a machine both run it.
pub struct Step {
    pub name: String,
    pub run: String,
    /// Relative to the repository's root.
    pub working_directory: Option<String>,
    /// A step that names `bash` gets `-o pipefail` from a runner.
    pub pipefail: bool,
    pub env: BTreeMap<String, String>,
}

/// A check as `PR CI` and `cargo x attest` need it.
pub struct Described {
    pub id: String,
    pub call: &'static str,
    /// The called workflow's file.
    pub workflow: &'static str,
    pub job: &'static str,
    /// The job's name in a `PR CI` run: `Web App / Biome Check`.
    pub name: String,
    /// The paths whose change makes `PR CI` run the job, sorted; `.` is
    /// any path.
    pub triggers: Vec<String>,
    /// The Nix dev shell the steps run in.
    pub dev_shell: String,
    /// The workflow's and the job's environment.
    pub env: BTreeMap<String, String>,
    pub steps: Vec<Step>,
    pub fingerprint: String,
}

fn call_of(id: &str) -> Option<&'static pr_ci::Call> {
    pr_ci::CALLS.iter().find(|call| call.id == id)
}

/// Whether `PR CI` hands this called workflow its attestations.
#[cfg(test)]
pub fn calls_attested(call: &pr_ci::Call) -> bool {
    CHECKS.iter().any(|check| check.call == call.id)
}

/// The generated workflow a call runs.
fn workflow_of(call: &pr_ci::Call) -> Result<&'static crate::workflows::WorkflowFile> {
    let uses = (call.workflow)().uses;
    crate::workflows::WORKFLOWS
        .iter()
        .find(|workflow| uses == format!("./.github/workflows/{}", workflow.file_name))
        .with_context(|| {
            format!(
                "`{}` calls {uses}, which is not a generated workflow",
                call.id
            )
        })
}

fn job<'a>(root: &'a serde_yaml::Value, id: &str, call: &str) -> Result<&'a serde_yaml::Value> {
    root.get("jobs")
        .and_then(|jobs| jobs.get(id))
        .with_context(|| format!("the workflow `{call}` calls has no job `{id}`"))
}

fn scalar(value: &serde_yaml::Value) -> Option<String> {
    match value {
        serde_yaml::Value::String(text) => Some(text.clone()),
        serde_yaml::Value::Bool(flag) => Some(flag.to_string()),
        serde_yaml::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// The directory or file a path pattern stays inside: everything before its
/// first wildcard segment. `crates/**/Cargo.toml` reads somewhere in `crates`;
/// a pattern that starts with a wildcard can read anywhere (`.`).
pub fn widen(pattern: &str) -> String {
    let literal: Vec<&str> = pattern
        .split('/')
        .take_while(|segment| !segment.contains(['*', '?', '[', '{']))
        .collect();
    if literal.is_empty() {
        ".".to_owned()
    } else {
        literal.join("/")
    }
}

/// Sorted, and without a path that another one already holds.
fn without_nested(mut paths: Vec<String>) -> Vec<String> {
    paths.sort();
    paths.dedup();
    if paths.iter().any(|path| path == ".") {
        return vec![".".to_owned()];
    }
    let all = paths.clone();
    paths.retain(|path| {
        !all.iter()
            .any(|other| path.starts_with(&format!("{other}/")))
    });
    paths
}

/// The patterns of each filter a selector job decides its outputs with.
fn selector_filters(root: &serde_yaml::Value) -> Result<BTreeMap<String, Vec<String>>> {
    let filters = root["jobs"][SELECTOR_JOB]["steps"]
        .as_sequence()
        .into_iter()
        .flatten()
        .find(|step| {
            step["uses"]
                .as_str()
                .is_some_and(|uses| uses.starts_with(FILTER_ACTION))
        })
        .and_then(|step| step["with"]["filters"].as_str())
        .context("the selector job has no path filter")?;
    serde_yaml::from_str(filters).context("a path filter is not a list of patterns per name")
}

/// The paths whose change makes `PR CI` run a job, each widened to the
/// directory it stays inside. For a path-filtered call they are the call's
/// paths; otherwise the selector's filters that the job's condition reads. A
/// job nothing filters runs for any change.
///
/// A machine uses them to tell which checks a branch needs. They are not what
/// a pass is recorded for: a job reads more than what triggers it.
pub fn triggers(root: &serde_yaml::Value, call: &pr_ci::Call, job_id: &str) -> Result<Vec<String>> {
    let patterns: Vec<String> = match call.paths {
        Some(paths) => paths.iter().map(|path| path.as_str().to_owned()).collect(),
        None => {
            let condition = job(root, job_id, call.id)?["if"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let filters = selector_filters(root)?;
            let read: Vec<String> = regex!(r"needs\.path-check\.outputs\.([a-z_]+)")
                .captures_iter(&condition)
                .filter_map(|capture| filters.get(&capture[1]).cloned())
                .flatten()
                .collect();
            if read.is_empty() {
                vec!["**".to_owned()]
            } else {
                read
            }
        }
    };

    Ok(without_nested(
        patterns.iter().map(|pattern| widen(pattern)).collect(),
    ))
}

/// An environment as a machine sets it: literal values as written, and the
/// check's own value for each one a runner computes.
fn environment(
    env: &serde_yaml::Value,
    check: &Check,
    owner: &str,
) -> Result<BTreeMap<String, String>> {
    let mut resolved = BTreeMap::new();
    for (name, value) in env.as_mapping().into_iter().flatten() {
        let name = name.as_str().context("an environment name is not text")?;
        let value = scalar(value).with_context(|| format!("{owner}: `{name}` is not a scalar"))?;

        let local = check
            .local_env
            .iter()
            .find(|(declared, _)| *declared == name);
        let value = match local {
            Some((_, local)) => (*local).to_owned(),
            None if value.contains("${{") || value.contains(RUNNER_HOME) => bail!(
                "{owner}: a runner computes `{name}` (`{value}`); give it a value in the check's `local_env`"
            ),
            None => value,
        };
        resolved.insert(name.to_owned(), value);
    }
    Ok(resolved)
}

/// A check step as a plain script. Anything a shell alone can't do is refused:
/// a machine would have to imitate the runner to follow it.
fn plain_step(step: &serde_yaml::Value, check: &Check) -> Result<Step> {
    let id = check.id();
    let name = step["name"]
        .as_str()
        .context("a check step has no name")?
        .to_owned();
    let run = step["run"]
        .as_str()
        .with_context(|| format!("{id}: `{name}` is not a `run` step"))?
        .to_owned();

    if run.contains("${{") {
        bail!("{id}: `{name}` has an expression in its script; pass the value through `env`");
    }
    for refused in ["if", "continue-on-error"] {
        if step.get(refused).is_some() {
            bail!("{id}: `{name}` sets `{refused}`, which only a runner follows");
        }
    }
    let pipefail = match step["shell"].as_str() {
        None => false,
        Some("bash") => true,
        Some(other) => bail!("{id}: `{name}` runs in {other}"),
    };
    let working_directory = match step.get("working-directory") {
        None => None,
        Some(directory) => {
            let directory = directory
                .as_str()
                .with_context(|| format!("{id}: `{name}` has an odd working directory"))?;
            if directory.contains("${{") || directory.starts_with('/') {
                bail!(
                    "{id}: `{name}` works in `{directory}`, which is not a path in the repository"
                );
            }
            Some(directory.to_owned())
        }
    };

    Ok(Step {
        env: environment(&step["env"], check, &format!("{id} `{name}`"))?,
        name,
        run,
        working_directory,
        pipefail,
    })
}

/// What a job must be for its steps to be the whole story.
fn plain_job(definition: &serde_yaml::Value, id: &str) -> Result<()> {
    for refused in ["services", "container", "strategy", "defaults"] {
        if definition.get(refused).is_some() {
            bail!("{id} sets `{refused}`, which a machine does not provide");
        }
    }
    Ok(())
}

/// Declares [`INPUT`] on a called workflow that holds attested jobs.
pub fn takes_attestations(call: WorkflowCall) -> WorkflowCall {
    call.add_input(
        INPUT,
        WorkflowInput::string()
            .description("JSON list of the checks PR CI accepted an attestation for, by id")
            .default("[]"),
    )
}

/// True unless `PR CI` accepted an attestation for the check `id`
/// (`<call>/<job>`). An attested job's condition ends with it. A run that is
/// not a call has no input, which reads as no attestation.
pub fn not_attested(id: &str) -> Expr<Bool> {
    !from_json::<Json>(input::<Str>(INPUT).or_else("[]")).contains(id)
}

/// The workflow a call runs, as generated.
fn rendered(call: &pr_ci::Call) -> Result<serde_yaml::Value> {
    let workflow = workflow_of(call)?;
    let yaml = (workflow.render_yaml)()?;
    serde_yaml::from_str(&yaml).with_context(|| format!("parsing {}", workflow.file_name))
}

/// A listed job must skip on its own entry, and its workflow must take the
/// list: without either, `Start` would accept a pass and the job would run
/// anyway, or not be handed the list at all.
fn skips_when_attested(
    root: &serde_yaml::Value,
    definition: &serde_yaml::Value,
    id: &str,
) -> Result<()> {
    let clause = not_attested(id).condition().0;
    let condition = definition["if"].as_str().unwrap_or_default();
    if condition != clause && !condition.ends_with(&format!(" && {clause}")) {
        bail!("{id}: its condition must end with `attestation::not_attested(\"{id}\")`");
    }
    if root["on"]["workflow_call"]["inputs"].get(INPUT).is_none() {
        bail!("{id}: its workflow must declare the input with `attestation::takes_attestations`");
    }
    Ok(())
}

/// What identifies the check a pass was for: the job as generated,
/// the workflow's environment, the steps that are the check, and what a
/// machine sets in a runner's place.
fn fingerprint(root: &serde_yaml::Value, check: &Check) -> Result<String> {
    let identity = json!({
        "job": serde_json::to_value(&root["jobs"][check.job])?,
        "env": serde_json::to_value(&root["env"])?,
        "steps": check.steps,
        "local_env": check.local_env,
    });
    let digest = Sha256::digest(serde_json::to_string(&identity)?);
    Ok(hex::encode(&digest[..8]))
}

fn describe(check: &Check) -> Result<Described> {
    let id = check.id();
    let call =
        call_of(check.call).with_context(|| format!("PR CI has no call `{}`", check.call))?;
    let root = rendered(call)?;
    let definition = job(&root, check.job, call.id)?;
    plain_job(definition, &id)?;
    skips_when_attested(&root, definition, &id)?;

    let own_name = definition["name"].as_str().unwrap_or(check.job);
    if own_name.contains("${{") {
        bail!("{id} is named by an expression");
    }

    let listed = definition["steps"]
        .as_sequence()
        .with_context(|| format!("{id} has no steps"))?;
    // A step in neither list is one nobody decided about: skipped, it would
    // let a machine attest a job without running part of it.
    for step in listed {
        if let Some(uses) = step["uses"].as_str() {
            let action = uses.split_once('@').map_or(uses, |(action, _)| action);
            if !RUNNER_ACTIONS.contains(&action) {
                bail!("{id} uses {action}; is it runner setup, or is the job not attestable?");
            }
            continue;
        }
        let name = step["name"].as_str().unwrap_or_default();
        if !check.steps.contains(&name) && !RUNNER_STEPS.contains(&name) {
            bail!("{id}: is `{name}` part of the check or runner upkeep?");
        }
    }
    let steps = check
        .steps
        .iter()
        .map(|name| {
            let step = listed
                .iter()
                .find(|step| step["name"].as_str() == Some(name))
                .with_context(|| format!("{id} has no step `{name}`"))?;
            plain_step(step, check)
        })
        .collect::<Result<Vec<Step>>>()?;

    let dev_shell = listed
        .iter()
        .find(|step| {
            step["uses"]
                .as_str()
                .is_some_and(|uses| uses.starts_with(DEV_SHELL_ACTION))
        })
        .and_then(|step| step["with"]["shell"].as_str())
        .unwrap_or(DEFAULT_DEV_SHELL)
        .to_owned();

    let mut env = environment(&root["env"], check, &id)?;
    env.extend(environment(&definition["env"], check, &id)?);

    // A value for a variable no one sets is a declaration gone stale.
    for (name, _) in check.local_env {
        let set = env.contains_key(*name) || steps.iter().any(|step| step.env.contains_key(*name));
        if !set {
            bail!("{id} declares a local `{name}`, which neither the job nor its steps set");
        }
    }

    Ok(Described {
        fingerprint: fingerprint(&root, check)?,
        triggers: triggers(&root, call, check.job)?,
        id,
        call: check.call,
        workflow: workflow_of(call)?.file_name,
        job: check.job,
        name: format!("{} / {own_name}", call.name),
        dev_shell,
        env,
        steps,
    })
}

/// Every check, read from the workflows as generated.
pub fn described() -> Result<Vec<Described>> {
    CHECKS.iter().map(describe).collect()
}

/// [`MANIFEST_FILE`]'s contents.
pub fn manifest() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| {
            let steps: Vec<serde_json::Value> = check
                .steps
                .iter()
                .map(|step| {
                    json!({
                        "name": step.name,
                        "run": step.run,
                        "working_directory": step.working_directory,
                        "pipefail": step.pipefail,
                        "env": step.env,
                    })
                })
                .collect();
            json!({
                "id": check.id,
                "call": check.call,
                "workflow": check.workflow,
                "job": check.job,
                "name": check.name,
                "fingerprint": check.fingerprint,
                "triggers": check.triggers,
                "dev_shell": check.dev_shell,
                "env": check.env,
                "steps": steps,
            })
        })
        .collect();
    let not_attestable: Vec<serde_json::Value> = NOT_ATTESTABLE
        .iter()
        .map(|job| json!({ "id": format!("{}/{}", job.call, job.job), "why": job.why }))
        .collect();

    let manifest = json!({
        "comment": "Generated by `cargo x workflows`; do not edit. The PR CI jobs `cargo x attest` can run, with the scripts a runner runs.",
        "status_prefix": STATUS_PREFIX,
        "checks": checks,
        "not_attestable": not_attestable,
    });
    Ok(format!("{}\n", serde_json::to_string_pretty(&manifest)?))
}

/// What `Start` needs to accept a status: the check and its fingerprint.
pub fn start_checks() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| json!({ "id": check.id, "fingerprint": check.fingerprint }))
        .collect();
    Ok(serde_json::to_string(&checks)?)
}

/// What the gate needs to find a check's job in the finished run.
pub fn gate_checks() -> Result<String> {
    let checks: Vec<serde_json::Value> = described()?
        .iter()
        .map(|check| json!({ "id": check.id, "name": check.name }))
        .collect();
    Ok(serde_json::to_string(&checks)?)
}
