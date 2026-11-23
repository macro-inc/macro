//! `check generated workflows` — fails a PR if the committed `.github/workflows`
//! YAML or `.github/kafka-cluster-topics.json` has drifted from its Rust source.
//! Generated into `check-generated-workflows.yml`. This is what makes "workflows
//! (and the kafka topics file) are defined in Rust" enforceable rather than
//! aspirational. A second job lints every workflow with actionlint (shellcheck
//! on `run` scripts) and every workflow and composite action with zizmor, from
//! the `workflow-lint` dev shell; their allowlists are `.github/actionlint.yaml`
//! and `.github/zizmor.yml`.

use gh_workflow::{Event, Job, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("tooling/xtask/**"),
    xtask_paths::repo_glob!("crates/macro_event_topics/**"),
    xtask_paths::repo_glob!(".github/workflows/**"),
    xtask_paths::repo_glob!(".github/actions/**"),
    xtask_paths::repo_glob!(".github/actionlint.yaml"),
    xtask_paths::repo_glob!(".github/zizmor.yml"),
    xtask_paths::repo_glob!("nix/workflow-lint.nix"),
    xtask_paths::repo_glob!("nix/patches/actionlint-*"),
    xtask_paths::repo_glob!(".github/kafka-cluster-topics.json"),
];

/// Build the workflow.
pub fn check_generated_workflows() -> Workflow {
    Workflow::new("check generated workflows")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("check-workflows", check_workflows())
        .add_job("lint-workflows", lint_workflows())
}

/// Regenerate in `--check` mode and fail on any difference.
fn check_workflows() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_rust_light())
        .add_step(
            Step::new("verify workflows are up to date")
                .run("cargo run --manifest-path tooling/xtask/Cargo.toml -- workflows --check"),
        )
        .add_step(
            Step::new("verify kafka cluster topics are up to date")
                .run("cargo run --manifest-path tooling/xtask/Cargo.toml -- kafka-topics --check"),
        )
}

/// Lint the committed workflows and composite actions. zizmor runs offline, so
/// the result depends only on the checkout.
fn lint_workflows() -> Job {
    Job::default()
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell_named("workflow-lint"))
        .add_step(Step::new("actionlint").run("actionlint"))
        .add_step(Step::new("zizmor").run("zizmor --offline .github"))
        .add_step(steps::teardown_nix())
}
