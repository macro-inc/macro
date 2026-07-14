//! `Reusable Preview Service` — pulumi preview (dry run) for one cloud-storage
//! service, called per changed service by `pulumi_preview_pr`. Generated into
//! `reusable_preview_service.yml` (replaces the hand-written
//! `reusable-preview-service.yml`).
//!
//! The preview job is pulumi-preview + occasional Lambda Nix builds (warm runs
//! are pure cache substitution), so `linux-small` suffices; it mounts the
//! profile's default `/nix` volume, with `setup-nix` before use and
//! `teardown-nix` after. Cold Lambda closures fall back to Cachix.

use anyhow::Result;
use gh_workflow::{Event, Job, Step, Use, Workflow, WorkflowCall};

use crate::workflows::{runners, steps};

/// Build the workflow. The `workflow_call` input/secret block is filled in by
/// [`patch`] (gh-workflow models it as unordered maps).
pub fn reusable_preview_service() -> Workflow {
    Workflow::new("Reusable Preview Service")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("preview", preview())
}

/// Fill in the ordered `workflow_call` inputs/secrets block.
///
/// Relative to the hand-written workflow this drops the `SCCACHE_BUCKET`
/// secret and its pass-through: Lambda artifacts build inside Nix derivations,
/// where S3 sccache never applied (the sole caller uses `secrets: inherit`, so
/// no caller change is needed).
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_call".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                required: true
                type: string
                description: The environment to preview
              service-name:
                required: true
                type: string
                description: The name of the service to preview
              pulumi-stack-name:
                required: false
                type: string
                description: Override pulumi stack name (defaults to service-name)
              use-docker:
                required: false
                type: boolean
                default: true
                description: Whether to setup docker
              use-lfs:
                required: false
                type: boolean
                default: false
                description: Whether to checkout LFS content
              github-token:
                required: false
                type: string
                description: GitHub token for PR comments
            secrets:
              AWS_ACCESS_KEY:
                required: true
              AWS_SECRET_ACCESS_KEY:
                required: true
              PULUMI_ACCESS_TOKEN:
                required: true
              DD_APP_KEY:
                required: true
              DD_API_KEY:
                required: true
              CACHIX_AUTH_TOKEN:
                required: true
        "#})?,
    );
    Ok(())
}

fn preview() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_step(checkout())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(get_project_name())
        .add_step(preview_pulumi())
        .add_step(steps::teardown_nix())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
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
    .add_with(("cachix-auth-token", "${{ secrets.CACHIX_AUTH_TOKEN }}"))
}
