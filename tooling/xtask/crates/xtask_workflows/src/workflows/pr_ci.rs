//! `PR CI` — the pull request checks, run when someone adds the [`RUN_LABEL`]
//! label instead of on every push. Generated into `pr-ci.yml`.
//!
//! `start` removes the label, so adding it again runs CI again, and checks that
//! the merge commit GitHub built holds the PR head. The check workflows run as
//! reusable workflows; the path-filtered ones only when their files changed.
//! `start` also reads the head's attestations ([`attestation`]) and hands the
//! accepted ones to the calls, whose attested jobs are skipped.
//! `CI gate` then sets the [`GATE_CONTEXT`] commit status on the PR head, which
//! `main` requires: a new push has no status until CI runs on it.
//!
//! The gate waits for every job, so every job sets `timeout-minutes`; GitHub's
//! default is six hours. A job's limit is the larger of twice its p99 run time
//! and 1.2 times its slowest run that no platform stall slowed, from the CI
//! telemetry in Loki (`infra/stacks/observability/README.md`), rounded up to 5
//! minutes. It is at least 10, or 15 for a job that sets up Nix (a cold setup
//! takes up to 9), and at least 5 more than any step limit inside it, such as
//! [`DEV_SHELL_TIMEOUT_MINUTES`](crate::workflows::vars::DEV_SHELL_TIMEOUT_MINUTES).
//! Status checks that only read other jobs' results get 5. A called job that
//! times out ends cancelled, which cancels its call and fails the gate.
//!
//! Every label fires `labeled`, so runs for any other label skip every job and
//! take a concurrency group of their own: they can't cancel a requested run or
//! post a result. Fork PRs get a read-only token, so `ci_gate_fork` removes
//! their label and sets their status.

use gh_workflow::expr::typed::{
    Bool, Expr, JobHandle, JobOutput, StepHandle, StepOutput, Str, cancelled, github, needs, steps,
    to_json, whole_needs,
};
use gh_workflow::{
    CallJob, Concurrency, Event, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step,
    Use, Workflow,
};
use xtask_paths::RepoGlob;

use crate::workflows::actions::{
    CallCargoDeny, CallCargoWorkspaceDependencyCheck, CallCheckGenerated, CallCheckNodeModulesNix,
    CallCheckTauriLockfiles, CallCodeCheckCloudStorage, CallCodeCheckConventions,
    CallCodeCheckInfra, CallObservabilityAws, CallObservabilityCluster, CallObservabilityImage,
    CallSdkCheck, CallTestMacrodUpdate, CallWebAppCheckMain, DornyPathsFilter,
};
use crate::workflows::{
    attestation, cargo_deny, cargo_workspace_dependency_check, check_generated,
    check_node_modules_nix, check_tauri_lockfiles, code_check_conventions, code_check_infra,
    observability_aws, observability_cluster, observability_image, runners, sdk_check, steps,
    test_macrod_update,
};

#[cfg(test)]
mod test;

/// Adding this label to a PR runs CI on its head.
pub const RUN_LABEL: &str = "run-ci";

/// The commit status `main`'s ruleset requires.
pub const GATE_CONTEXT: &str = "CI gate";

/// Where the status links before CI has run: how to run it and wait on it.
pub const GATE_DOCS_URL: &str =
    "https://github.com/macro-inc/macro/blob/main/.agents/skills/run-ci/SKILL.md";

fn requested() -> Expr<Bool> {
    github().event::<Str>("label.name").eq(RUN_LABEL)
}

fn pr_number() -> Expr<Str> {
    github().event("pull_request.number")
}

/// Job names the fork step reads back from a finished run (`ci_gate.ts`).
pub const START_JOB: &str = "Start";
pub const GATE_JOB: &str = "CI gate";

/// What [`START`] decided about the head's attestations
/// ([`attestation`]).
struct Attestations<Output> {
    /// The checks whose jobs this run skips, a JSON list of ids.
    attested: Output,
    /// The accepted checks this run runs anyway, a JSON list of ids.
    audited: Output,
    /// The tree of the merge commit the run tests.
    tree: Output,
}

/// Takes the request, reads the head's attestations and path-filters the
/// calls. Besides these, its outputs are one flag per path-filtered call,
/// named by [`output_name`] at run time.
const START: JobHandle<Attestations<JobOutput<Str>>> = JobHandle::new(
    "start",
    Attestations {
        attested: JobOutput::new("start", "attested"),
        audited: JobOutput::new("start", "audited"),
        tree: JobOutput::new("start", "tree"),
    },
);
/// The step of [`START`] that accepts attestations and draws the audits.
const ATTESTATIONS: StepHandle<Attestations<StepOutput<Str>>> = StepHandle::new(
    "attestations",
    Attestations {
        attested: StepOutput::new("attestations", "attested"),
        audited: StepOutput::new("attestations", "audited"),
        tree: StepOutput::new("attestations", "tree"),
    },
);
/// The path filter in [`START`]; one output per path-filtered call.
const FILTER: StepHandle<()> = StepHandle::new("filter", ());

/// The checks [`START`] accepted, as a call hands them to its workflow.
fn attested() -> Expr<Str> {
    START.outputs.attested.read()
}

/// A check workflow `PR CI` calls.
pub(crate) struct Call {
    pub(crate) id: &'static str,
    /// Prefixes the called jobs' check names: `Web App / Typecheck`.
    pub(crate) name: &'static str,
    /// A job calling the workflow; [`call_job`] names it and passes secrets.
    /// A workflow with attested jobs is handed [`attested`].
    pub(crate) workflow: fn() -> CallJob,
    /// Files that make it run; `None` runs it on every request.
    pub(crate) paths: Option<&'static [RepoGlob<'static>]>,
}

pub(crate) const CALLS: &[Call] = &[
    Call {
        id: "cloud-storage",
        name: "Cloud Storage",
        workflow: || CallCodeCheckCloudStorage::new().attested(attested()).job(),
        paths: None,
    },
    Call {
        id: "web-app",
        name: "Web App",
        workflow: || CallWebAppCheckMain::new().job(),
        paths: None,
    },
    Call {
        id: "infra",
        name: "Infra",
        workflow: || CallCodeCheckInfra::new().attested(attested()).job(),
        paths: Some(code_check_infra::PATHS),
    },
    Call {
        id: "conventions",
        name: "Conventions",
        workflow: || CallCodeCheckConventions::new().attested(attested()).job(),
        paths: Some(code_check_conventions::PATHS),
    },
    Call {
        id: "cargo-deny",
        name: "cargo deny",
        workflow: || CallCargoDeny::new().job(),
        paths: Some(cargo_deny::PATHS),
    },
    Call {
        id: "workspace-dependencies",
        name: "Workspace dependencies",
        workflow: || {
            CallCargoWorkspaceDependencyCheck::new()
                .attested(attested())
                .job()
        },
        paths: Some(cargo_workspace_dependency_check::PATHS),
    },
    Call {
        id: "generated-workflows",
        name: "Generated workflows",
        workflow: || CallCheckGenerated::new().attested(attested()).job(),
        paths: Some(check_generated::PATHS),
    },
    Call {
        id: "node-modules-nix",
        name: "node_modules nix",
        workflow: || CallCheckNodeModulesNix::new().attested(attested()).job(),
        paths: Some(check_node_modules_nix::PATHS),
    },
    Call {
        id: "tauri-lockfiles",
        name: "Tauri lockfiles",
        workflow: || CallCheckTauriLockfiles::new().job(),
        paths: Some(check_tauri_lockfiles::PATHS),
    },
    Call {
        id: "sdk",
        name: "SDK",
        workflow: || CallSdkCheck::new().attested(attested()).job(),
        paths: Some(sdk_check::PATHS),
    },
    Call {
        id: "observability-aws",
        name: "Observability AWS layer",
        workflow: || CallObservabilityAws::new().job(),
        paths: Some(observability_aws::PATHS),
    },
    Call {
        id: "observability-image",
        name: "Observability image",
        workflow: || CallObservabilityImage::new().attested(attested()).job(),
        paths: Some(observability_image::PATHS),
    },
    Call {
        id: "observability-cluster",
        name: "Observability cluster",
        workflow: || CallObservabilityCluster::new().job(),
        paths: Some(observability_cluster::PATHS),
    },
    Call {
        id: "macrod-update",
        name: "macrod update",
        workflow: || CallTestMacrodUpdate::new().attested(attested()).job(),
        paths: Some(test_macrod_update::PATHS),
    },
];

/// Build the workflow.
pub fn pr_ci() -> Workflow {
    let workflow = Workflow::new("PR CI")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Labeled),
        ))
        .concurrency(
            // One group per PR for requests, so a newer request cancels the
            // older run; a group per run for every other label.
            Concurrency::new(format!(
                "pr-ci-{}-{}",
                pr_number(),
                requested().then_else("requested", github().run_id())
            ))
            .cancel_in_progress(true),
        )
        .add_job(START, start());

    CALLS
        .iter()
        .fold(workflow, |workflow, call| {
            workflow.add_job(call.id, call_job(call))
        })
        .add_job("gate", gate())
}

/// The output that says whether a path-filtered call runs.
fn output_name(call: &Call) -> String {
    call.id.replace('-', "_")
}

/// A step running `scripts/ci_gate.ts` in one of its modes.
pub(crate) fn gate_step(name: &str, mode: &str) -> Step<Run> {
    Step::new(name)
        .run(steps::node_script(include_str!("scripts/ci_gate.ts")))
        .shell("bash")
        .add_env(("CI_GATE_MODE", mode))
        .add_env(("CI_GATE_CONTEXT", GATE_CONTEXT))
        .add_env(("CI_GATE_LABEL", RUN_LABEL))
        .add_env(("GH_TOKEN", github().token()))
}

/// The PR facts the start and gate steps act on.
fn with_pull_request(step: Step<Run>) -> Step<Run> {
    step.add_env(("PR_NUMBER", pr_number()))
        .add_env(("HEAD_SHA", github().event::<Str>("pull_request.head.sha")))
        .add_env((
            "SAME_REPO",
            github()
                .event::<Str>("pull_request.head.repo.full_name")
                .eq(github().repository()),
        ))
        .add_env((
            "RUN_URL",
            format!(
                "{}/{}/actions/runs/{}",
                github().server_url(),
                github().repository(),
                github().run_id()
            ),
        ))
}

fn start() -> Job {
    let job = Job::default()
        .name(START_JOB)
        .cond(requested())
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(5u32)
        .permissions(Permissions {
            contents: Some(Level::Read),
            issues: Some(Level::Write),
            pull_requests: Some(Level::Write),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            with_pull_request(gate_step("Take the request", "start"))
                .add_env(("MERGE_SHA", github().sha())),
        )
        .add_step(
            with_pull_request(gate_step("Read the head's attestations", "attestations"))
                .id(ATTESTATIONS.id())
                .add_env(("MERGE_SHA", github().sha()))
                .add_env(("ATTESTABLE_CHECKS", start_checks()))
                .add_env(("ATTESTED_PREFIX", attestation::STATUS_PREFIX))
                .add_env(("AUDIT_ONE_IN", attestation::AUDIT_ONE_IN.to_string())),
        )
        .add_step(paths_filter())
        .add_output(
            START.outputs.attested.name(),
            ATTESTATIONS.outputs.attested.read(),
        )
        .add_output(
            START.outputs.audited.name(),
            ATTESTATIONS.outputs.audited.read(),
        )
        .add_output(START.outputs.tree.name(), ATTESTATIONS.outputs.tree.read());

    CALLS
        .iter()
        .filter(|call| call.paths.is_some())
        .fold(job, |job, call| {
            let output = output_name(call);
            job.add_output(output.clone(), steps(FILTER.id()).output(&output))
        })
}

/// One filter per path-filtered call, from the same list its push trigger uses.
/// The PR's files come from the API, so no checkout.
fn paths_filter() -> Step<Use> {
    let filters: String = CALLS
        .iter()
        .filter_map(|call| call.paths.map(|paths| (output_name(call), paths)))
        .map(|(output, paths)| {
            let globs: String = paths
                .iter()
                .map(|path| format!("  - '{}'\n", path.as_str()))
                .collect();
            format!("{output}:\n{globs}")
        })
        .collect();

    DornyPathsFilter::new("Filter changed paths", filters)
        .step()
        .id(FILTER.id())
}

fn call_job(call: &Call) -> CallJob {
    let job = (call.workflow)()
        .name(call.name)
        .add_needs(START)
        .inherit_secrets();

    match call.paths {
        Some(_) => job.cond(needs(START.id()).output(&output_name(call)).is_true()),
        None => job,
    }
}

/// Runs unless the run was cancelled (a newer request superseded it) or was
/// never a request. A skipped call is a path filter that didn't match.
fn gate() -> Job {
    let needed = std::iter::once(START.id())
        .chain(CALLS.iter().map(|call| call.id))
        .map(str::to_string)
        .collect::<Vec<_>>();

    Job::default()
        .name(GATE_JOB)
        .needs(needed)
        .cond((!cancelled()).and(START.result().ne("skipped")))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(5u32)
        .permissions(Permissions {
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            with_pull_request(gate_step("Set the CI gate status", "finish"))
                .add_env(("NEEDS", to_json(whole_needs())))
                .add_env(("ATTESTED", START.outputs.attested.read()))
                .add_env(("AUDITED", START.outputs.audited.read()))
                .add_env(("TREE", START.outputs.tree.read()))
                .add_env(("ATTESTABLE_CHECKS", start_checks()))
                .add_env(("ATTESTED_PREFIX", attestation::STATUS_PREFIX))
                .add_env((
                    "GATE_CHECKS",
                    attestation::gate_checks().expect("the attested checks render"),
                ))
                .add_env(("RUN_ID", github().run_id())),
        )
}

/// The attestable checks and their fingerprints, for the gate script.
fn start_checks() -> String {
    attestation::start_checks().expect("the attested checks render")
}
