//! `check bun.nix` — verifies that the generated `js/bun.nix` matches the
//! committed Bun lockfile/package manifests. Generated into `check_bun_nix.yml`.

use gh_workflow::{Event, Job, PullRequest, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn check_bun_nix() -> Workflow {
    Workflow::new("check bun.nix")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path("js/bun.lock")
                .add_path("js/bun.nix")
                .add_path("js/**/package.json")
                .add_path("scripts/update-bun-nix.sh")
                .add_path("justfile")
                .add_path("flake.nix")
                .add_path("flake.lock")
                .add_path(".github/workflows/check_bun_nix.yml"),
        ))
        .add_job("check-bun-nix", check_bun_nix_job())
}

fn check_bun_nix_job() -> Job {
    Job::default()
        .runs_on(runners::Runner::LinuxSmall.to_string())
        .add_step(steps::checkout(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_cachix())
        .add_step(verify_bun_nix())
}

fn verify_bun_nix() -> Step<gh_workflow::Run> {
    Step::new("verify js/bun.nix is up to date").run("scripts/update-bun-nix.sh --check")
}
