//! `check generated workflows` — fails a PR if the committed `.github/workflows`
//! YAML has drifted from this Rust source. Generated into
//! `check-generated-workflows.yml`. This is what makes "workflows are defined in
//! Rust" enforceable rather than aspirational.

use gh_workflow::{Event, Job, PullRequest, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn check_generated_workflows() -> Workflow {
    Workflow::new("check generated workflows")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path("rust/cloud-storage/tools/xtask/**")
                .add_path(".github/workflows/**"),
        ))
        .add_job("check-workflows", check_workflows())
}

/// Regenerate in `--check` mode and fail on any difference.
fn check_workflows() -> Job {
    Job::default()
        .runs_on(runners::Runner::LinuxSmall.to_string())
        .add_step(steps::checkout(false))
        .add_step(steps::setup_rust_light())
        .add_step(
            Step::new("verify workflows are up to date").run(
                "cargo run --manifest-path rust/cloud-storage/tools/xtask/Cargo.toml -- workflows --check",
            ),
        )
}
