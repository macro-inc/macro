//! `PR CI` — the pull request checks, run when someone adds the [`RUN_LABEL`]
//! label instead of on every push. Generated into `pr-ci.yml`.
//!
//! `start` removes the label, so adding it again runs CI again, and checks that
//! the merge commit GitHub built holds the PR head. The check workflows run as
//! reusable workflows; the path-filtered ones only when their files changed.
//! `CI gate` then sets the [`GATE_CONTEXT`] commit status on the PR head, which
//! `main` requires: a new push has no status until CI runs on it.
//!
//! Every label fires `labeled`, so runs for any other label skip every job and
//! take a concurrency group of their own: they can't cancel a requested run or
//! post a result. Fork PRs get a read-only token, so `ci_gate_fork` removes
//! their label and sets their status.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    cargo_deny, cargo_workspace_dependency_check, check_generated, check_node_modules_nix,
    check_tauri_lockfiles, sdk_check, steps, test_macrod_update,
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

const REQUESTED: &str = "github.event.label.name == 'run-ci'";

/// Job names the fork step reads back from a finished run (`ci_gate.ts`).
const START_JOB: &str = "Start";
const GATE_JOB: &str = "CI gate";

/// A check workflow `PR CI` calls.
struct Call {
    id: &'static str,
    /// Prefixes the called jobs' check names: `Web App / Typecheck`.
    name: &'static str,
    file: &'static str,
    /// Files that make it run; `None` runs it on every request.
    paths: Option<&'static [RepoGlob<'static>]>,
}

const CALLS: &[Call] = &[
    Call {
        id: "cloud-storage",
        name: "Cloud Storage",
        file: "code_check_cloud_storage.yml",
        paths: None,
    },
    Call {
        id: "web-app",
        name: "Web App",
        file: "web-app-check-main.yml",
        paths: None,
    },
    Call {
        id: "infra",
        name: "Infra",
        file: "code_check_infra.yml",
        paths: None,
    },
    Call {
        id: "conventions",
        name: "Conventions",
        file: "code_check_conventions.yml",
        paths: None,
    },
    Call {
        id: "cargo-deny",
        name: "cargo deny",
        file: "cargo_deny.yml",
        paths: Some(cargo_deny::PATHS),
    },
    Call {
        id: "workspace-dependencies",
        name: "Workspace dependencies",
        file: "cargo_workspace_dependency_check.yml",
        paths: Some(cargo_workspace_dependency_check::PATHS),
    },
    Call {
        id: "generated-workflows",
        name: "Generated workflows",
        file: "check_generated.yml",
        paths: Some(check_generated::PATHS),
    },
    Call {
        id: "node-modules-nix",
        name: "node_modules nix",
        file: "check_node_modules_nix.yml",
        paths: Some(check_node_modules_nix::PATHS),
    },
    Call {
        id: "tauri-lockfiles",
        name: "Tauri lockfiles",
        file: "check_tauri_lockfiles.yml",
        paths: Some(check_tauri_lockfiles::PATHS),
    },
    Call {
        id: "sdk",
        name: "SDK",
        file: "sdk-check.yml",
        paths: Some(sdk_check::PATHS),
    },
    Call {
        id: "macrod-update",
        name: "macrod update",
        file: "test_macrod_update.yml",
        paths: Some(test_macrod_update::PATHS),
    },
];

/// Build the workflow.
pub fn pr_ci() -> Workflow {
    let workflow = Workflow::new("PR CI")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_branch("synoet/ci-gate-base")
                .add_type(PullRequestType::Labeled),
        ))
        .concurrency(
            // One group per PR for requests, so a newer request cancels the
            // older run; a group per run for every other label.
            Concurrency::new(Expression::new(format!(
                "pr-ci-${{{{ github.event.pull_request.number }}}}-${{{{ {REQUESTED} && 'requested' || github.run_id }}}}"
            )))
            .cancel_in_progress(true),
        )
        .add_job("start", start());

    CALLS
        .iter()
        .fold(workflow, |workflow, call| {
            workflow.add_job(call.id, call_job(call))
        })
        .add_job("gate", gate())
}

/// Fill in what gh-workflow can't express on a reusable-workflow call.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    for call in CALLS {
        let job = crate::workflows::job_mut(root, call.id)?;
        job.remove("runs-on");
        job.insert("secrets".into(), "inherit".into());
    }
    Ok(())
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
        .add_env(("GH_TOKEN", "${{ github.token }}"))
}

/// The PR facts the start and gate steps act on.
fn with_pull_request(step: Step<Run>) -> Step<Run> {
    step.add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
        .add_env((
            "SAME_REPO",
            "${{ github.event.pull_request.head.repo.full_name == github.repository }}",
        ))
        .add_env((
            "RUN_URL",
            "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        ))
}

fn start() -> Job {
    let job = Job::default()
        .name(START_JOB)
        .cond(Expression::new(REQUESTED))
        .runs_on("ubuntu-latest")
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
                .add_env(("MERGE_SHA", "${{ github.sha }}")),
        )
        .add_step(paths_filter());

    CALLS
        .iter()
        .filter(|call| call.paths.is_some())
        .fold(job, |job, call| {
            let output = output_name(call);
            job.add_output(
                output.clone(),
                format!("${{{{ steps.filter.outputs.{output} }}}}"),
            )
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

    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("filter")
        .add_with(("filters", filters))
}

fn call_job(call: &Call) -> Job {
    let job = Job::default()
        .name(call.name)
        .needs(vec!["start".to_string()])
        .uses(format!("./.github/workflows/{}", call.file));

    match call.paths {
        Some(_) => job.cond(Expression::new(format!(
            "needs.start.outputs.{} == 'true'",
            output_name(call)
        ))),
        None => job,
    }
}

/// Runs unless the run was cancelled (a newer request superseded it) or was
/// never a request. A skipped call is a path filter that didn't match.
fn gate() -> Job {
    let needs = std::iter::once("start")
        .chain(CALLS.iter().map(|call| call.id))
        .map(str::to_string)
        .collect::<Vec<_>>();

    Job::default()
        .name(GATE_JOB)
        .needs(needs)
        .cond(Expression::new(
            "!cancelled() && needs.start.result != 'skipped'",
        ))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            with_pull_request(gate_step("Set the CI gate status", "finish"))
                .add_env(("NEEDS", "${{ toJSON(needs) }}")),
        )
}
