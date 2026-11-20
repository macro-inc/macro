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

use gh_workflow::expr::typed::{Bool, StepHandle, StepOutput, Str, input};
use gh_workflow::{
    Event, Job, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput, ZizmorRule,
};

use crate::workflows::actions::{
    ActionsCheckout, LocalGetProjectName, LocalPreviewCloudStoragePulumi,
};
use crate::workflows::{runners, steps, vars};

pub(crate) struct ProjectNameOutputs {
    /// The service's Pulumi project name.
    pub project_name: StepOutput<Str>,
}

/// The step that resolves the service's Pulumi project, when no stack name is
/// given.
pub(crate) const PROJECT_NAME: StepHandle<ProjectNameOutputs> = StepHandle::new(
    "project-name",
    ProjectNameOutputs {
        project_name: LocalGetProjectName::project_name_output("project-name"),
    },
);

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
    ActionsCheckout::new("Checkout Repo").step().zizmor_ignore(
        ZizmorRule::Artipacked,
        "Pulumi previews run from the checkout",
    )
}

fn get_project_name() -> Step<Use> {
    LocalGetProjectName::new("Get project name", input::<Str>("service-name"))
        .step()
        .id(PROJECT_NAME.id())
}

fn preview_pulumi() -> Step<Use> {
    LocalPreviewCloudStoragePulumi::new(
        "Preview pulumi stack",
        vars::AWS_ACCESS_KEY,
        vars::AWS_SECRET_ACCESS_KEY,
        vars::PULUMI_ACCESS_TOKEN,
        input::<Str>("pulumi-stack-name").or_else(PROJECT_NAME.outputs.project_name.read()),
        vars::DD_APP_KEY,
        vars::DD_API_KEY,
    )
    .environment(input::<Str>("environment"))
    .use_docker(input::<Bool>("use-docker"))
    .use_lfs(input::<Bool>("use-lfs"))
    .github_token(input::<Str>("github-token"))
    .cloud_storage_service_name(input::<Str>("service-name"))
    .step()
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
            yaml.contains(&format!("nix-cache-url: {}", vars::NIX_CACHE_URL)),
            "{yaml}"
        );
        assert!(!yaml.contains("NIX_CACHE_SIGNING_KEY"), "{yaml}");
    }
}
