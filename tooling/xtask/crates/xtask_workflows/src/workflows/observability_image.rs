//! `Observability image` — builds the observability host's NixOS image on a
//! pull request that changes it, so a broken image fails before merge instead
//! of in a deploy. `PR CI` calls it when [`PATHS`] change; it holds no
//! credentials. Generated into `observability_image.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::deploy_observability::{CACHE_TAG, build_image, nix_steps};
use crate::workflows::{runners, steps};

/// Everything the image is built from (`deploy/image-key.ts`), plus this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("infra/stacks/observability/flake.nix"),
    xtask_paths::repo_glob!("infra/stacks/observability/flake.lock"),
    xtask_paths::repo_glob!("infra/stacks/observability/nixos/**"),
    xtask_paths::repo_glob!("infra/stacks/observability/assets/**"),
    xtask_paths::repo_glob!(".github/workflows/observability_image.yml"),
];

/// Build the workflow.
pub fn observability_image() -> Workflow {
    Workflow::new("Observability image")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("build-image", build_image_job())
}

fn build_image_job() -> Job {
    nix_steps(
        Job::default()
            .name("Build observability image")
            .runs_on(runners::Runner::Mid.with_cache_tag(CACHE_TAG))
            .timeout_minutes(15u32),
    )
    .add_step(build_image())
    .add_step(steps::teardown_nix())
}
