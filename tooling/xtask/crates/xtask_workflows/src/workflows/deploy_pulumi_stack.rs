//! `deploy pulumi service` — manually deploys one Pulumi stack, named by its
//! folder under `infra/stacks`, to dev or prod. Generated into
//! `deploy-pulumi-stack.yml`.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow. The dispatch input block is filled in by [`patch`].
pub fn deploy_pulumi_stack() -> Workflow {
    Workflow::new("deploy pulumi service")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ inputs.pulumi-service-name }}-${{ inputs.environment }}",
            ))
            .cancel_in_progress(false),
        )
        .add_job("setup", setup())
        .add_job("check-migrations", check_migrations())
        .add_job("deploy", deploy())
}

/// Fill in the ordered dispatch input block.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                type: choice
                required: true
                default: dev
                options:
                  - dev
                  - prod
                description: The environment we are deploying to.
              pulumi-service-name:
                type: string
                required: true
                description: The name of the pulumi service to deploy. This will be the exact name of the folder containing your stacks.
              cloud-storage-service-name:
                type: string
                required: false
                description: Optional service key from .github/services-config.json; set this for Lambda-backed stacks so CI can build Lambda zips before Pulumi runs.
        "#})?,
    );
    Ok(())
}

/// Resolve whether the stack belongs to a service with binaries or Lambdas,
/// so infrastructure-only stacks (including the migration runner's own) skip
/// the migration check.
fn setup() -> Job {
    Job::default()
        .name("Check whether ${{ inputs.pulumi-service-name }} ships service code")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("ships_code", "${{ steps.check.outputs.ships_code }}")
        .add_step(steps::checkout_v4().add_with(("sparse-checkout", ".github/")))
        .add_step(check_artifact_config())
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            ships_code=$(jq -r --arg stack_path "infra/stacks/$STACK/**" '
              [.services[] | select(.stack_path == $stack_path) | (.deploy_binaries // []) + (.deploy_lambdas // []) | length]
              | add // 0
              | . > 0
            ' .github/services-config.json)
            echo "ships_code=$ships_code" >> "$GITHUB_OUTPUT"
            echo "stack=$STACK ships_code=$ships_code"
        "#})
        .id("check")
        .add_env(Env::new("STACK", "${{ inputs.pulumi-service-name }}"))
}

fn check_migrations() -> Job {
    steps::check_macro_db_migrations_job(
        "Check ${{ inputs.pulumi-service-name }} migrations are applied",
        "needs.setup.outputs.ships_code == 'true'",
    )
}

/// The migration check is skipped for stacks it does not apply to, so proceed
/// as long as nothing actually failed or was cancelled.
fn deploy() -> Job {
    Job::default()
        .needs(vec!["setup".to_string(), "check-migrations".to_string()])
        .cond(Expression::new("${{ !failure() && !cancelled() }}"))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(deploy_stack())
        .add_step(steps::teardown_nix())
}

fn deploy_stack() -> Step<Use> {
    steps::uses_local(
        "Deploy ${{ inputs.pulumi-service-name }}",
        xtask_paths::repo_dir!(".github/actions/deploy-cloud-storage-pulumi"),
    )
    .add_with(("environment", "${{ inputs.environment }}"))
    .add_with(("aws-access-key", vars::AWS_ACCESS_KEY))
    .add_with(("aws-secret-key", vars::AWS_SECRET_ACCESS_KEY))
    .add_with(("pulumi-access-token", vars::PULUMI_ACCESS_TOKEN))
    .add_with(("pulumi-service-name", "${{ inputs.pulumi-service-name }}"))
    .add_with((
        "cloud-storage-service-name",
        "${{ inputs.cloud-storage-service-name }}",
    ))
    .add_with(("dd-app-key", vars::DD_APP_KEY))
    .add_with(("dd-api-key", vars::DD_API_KEY))
}
