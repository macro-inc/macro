//! `Reusable Preview Service` — pulumi preview (dry run) for one cloud-storage
//! service, called per changed service by `pulumi_preview_pr`. Generated into
//! `reusable_preview_service.yml` (replaces the hand-written
//! `reusable-preview-service.yml`).
//!
//! The preview job is pulumi-preview + occasional Lambda Nix builds, so
//! `linux-small` suffices; it mounts the profile's default `/nix` volume, with
//! `setup-nix` before use and `teardown-nix` after. A node without that volume
//! would compile every Lambda, so it reads the deploy pipeline's S3 binary cache
//! too, which makes an unchanged handler a download. It holds no signing key, so
//! it can't write to that cache.

use gh_workflow::{
    Event, Job, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput,
};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn reusable_preview_service() -> Workflow {
    Workflow::new("Reusable Preview Service")
        .on(Event::default().workflow_call(
            WorkflowCall::default()
                .add_input(
                    "environment",
                    WorkflowInput::string()
                        .description("The environment to preview")
                        .required(true),
                )
                .add_input(
                    "service-name",
                    WorkflowInput::string()
                        .description("The name of the service to preview")
                        .required(true),
                )
                .add_input(
                    "pulumi-stack-name",
                    WorkflowInput::string()
                        .description("Override pulumi stack name (defaults to service-name)")
                        .required(false),
                )
                .add_input(
                    "use-docker",
                    WorkflowInput::boolean()
                        .description("Whether to setup docker")
                        .required(false)
                        .default(true),
                )
                .add_input(
                    "use-lfs",
                    WorkflowInput::boolean()
                        .description("Whether to checkout LFS content")
                        .required(false)
                        .default(false),
                )
                .add_input(
                    "github-token",
                    WorkflowInput::string()
                        .description("GitHub token for PR comments")
                        .required(false),
                )
                .add_secret(
                    "AWS_ACCESS_KEY",
                    WorkflowCallSecret::default().required(true),
                )
                .add_secret(
                    "AWS_SECRET_ACCESS_KEY",
                    WorkflowCallSecret::default().required(true),
                )
                .add_secret(
                    "PULUMI_ACCESS_TOKEN",
                    WorkflowCallSecret::default().required(true),
                )
                .add_secret("DD_APP_KEY", WorkflowCallSecret::default().required(true))
                .add_secret("DD_API_KEY", WorkflowCallSecret::default().required(true)),
        ))
        .add_job("preview", preview())
}

fn preview() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_step(checkout())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(get_project_name())
        .add_step(preview_pulumi())
        .add_step(steps::teardown_nix())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses("actions", "checkout", steps::CHECKOUT_SHA)
}

fn get_project_name() -> Step<Use> {
    steps::uses_local(
        "Get project name",
        xtask_paths::repo_dir!(".github/actions/get-project-name"),
    )
    .id("project-name")
    .add_with(("service-name", "${{ inputs.service-name }}"))
}

fn preview_pulumi() -> Step<Use> {
    steps::uses_local(
        "Preview pulumi stack",
        xtask_paths::repo_dir!(".github/actions/preview-cloud-storage-pulumi"),
    )
    .add_with(("environment", "${{ inputs.environment }}"))
    .add_with(("aws-access-key", "${{ secrets.AWS_ACCESS_KEY }}"))
    .add_with(("aws-secret-key", "${{ secrets.AWS_SECRET_ACCESS_KEY }}"))
    .add_with(("pulumi-access-token", "${{ secrets.PULUMI_ACCESS_TOKEN }}"))
    .add_with((
        "pulumi-service-name",
        "${{ inputs.pulumi-stack-name || steps.project-name.outputs.project-name }}",
    ))
    .add_with(("dd-app-key", "${{ secrets.DD_APP_KEY }}"))
    .add_with(("dd-api-key", "${{ secrets.DD_API_KEY }}"))
    .add_with(("use-docker", "${{ inputs.use-docker }}"))
    .add_with(("use-lfs", "${{ inputs.use-lfs }}"))
    .add_with(("github-token", "${{ inputs.github-token }}"))
    .add_with(("cloud-storage-service-name", "${{ inputs.service-name }}"))
}

#[cfg(test)]
mod test {
    use super::*;

    /// Preview reads the binary cache so a cold node needn't compile Lambdas, and
    /// holds no signing key, so it can't write to the cache.
    #[test]
    fn preview_reads_the_nix_cache_and_cannot_write_it() {
        let yaml = reusable_preview_service()
            .to_string()
            .expect("workflow yaml");
        assert!(
            yaml.contains("nix-cache-url: ${{ vars.NIX_CACHE_URL }}"),
            "{yaml}"
        );
        assert!(!yaml.contains("NIX_CACHE_SIGNING_KEY"), "{yaml}");
    }
}
