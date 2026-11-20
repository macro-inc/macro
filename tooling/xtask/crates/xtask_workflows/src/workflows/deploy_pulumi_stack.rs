//! `deploy pulumi service` — manually deploys one Pulumi stack, named by its
//! folder under `infra/stacks`, to dev or prod. Generated into
//! `deploy-pulumi-stack.yml`.

use gh_workflow::expr::typed::{
    Expr, Flag, JobHandle, JobOutput, StepHandle, StepOutput, Str, cancelled, failure, github,
    input,
};
use gh_workflow::{
    Concurrency, Env, Event, Job, Run, Step, Use, Workflow, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::LocalDeployCloudStoragePulumi;
use crate::workflows::{runners, steps, vars};

pub(crate) struct SetupOutputs {
    /// Whether the stack ships service code (binaries or Lambdas).
    pub ships_code: JobOutput<Flag>,
}

/// The job that resolves whether the stack ships service code.
pub(crate) const SETUP: JobHandle<SetupOutputs> = JobHandle::new(
    "setup",
    SetupOutputs {
        ships_code: JobOutput::new("setup", "ships_code"),
    },
);

pub(crate) struct CheckOutputs {
    /// Whether the stack ships service code.
    pub ships_code: StepOutput<Flag>,
}

/// The step that writes [`SETUP`]'s output.
pub(crate) const CHECK: StepHandle<CheckOutputs> = StepHandle::new(
    "check",
    CheckOutputs {
        ships_code: StepOutput::new("check", "ships_code"),
    },
);

pub(crate) const CHECK_MIGRATIONS: JobHandle<()> = JobHandle::new("check-migrations", ());

/// The `pulumi-service-name` input: the stack's folder under `infra/stacks`.
fn stack() -> Expr<Str> {
    input("pulumi-service-name")
}

/// Build the workflow.
pub fn deploy_pulumi_stack() -> Workflow {
    Workflow::new("deploy pulumi service")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default().add_input("environment", WorkflowInput::choice(["dev", "prod"]).description("The environment we are deploying to.").required(true).default("dev")).add_input("pulumi-service-name", WorkflowInput::string().description("The name of the pulumi service to deploy. This will be the exact name of the folder containing your stacks.").required(true)).add_input("cloud-storage-service-name", WorkflowInput::string().description("Optional service key from .github/services-config.json; set this for Lambda-backed stacks so CI can build Lambda zips before Pulumi runs.").required(false))))
        .concurrency(
            Concurrency::new(format!(
                "{}-{}-{}",
                github().workflow(),
                stack(),
                input::<Str>("environment")
            ))
            .cancel_in_progress(false),
        )
        .add_job(SETUP, setup())
        .add_job(CHECK_MIGRATIONS, check_migrations())
        .add_job("deploy", deploy())
}

/// Resolve whether the stack belongs to a service with binaries or Lambdas,
/// so infrastructure-only stacks (including the migration runner's own) skip
/// the migration check.
fn setup() -> Job {
    Job::default()
        .name(format!("Check whether {} ships service code", stack()))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            SETUP.outputs.ships_code.name(),
            CHECK.outputs.ships_code.read(),
        )
        .add_step(steps::checkout_v4_action().sparse_checkout(".github/"))
        .add_step(check_artifact_config())
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            # The deploy runs Pulumi in infra/stacks/$STACK, so any other
            # spelling of a folder (`stack/`, `./stack`) would deploy it while
            # missing its services-config entry below.
            if [[ ! "$STACK" =~ ^[A-Za-z0-9_-]+$ ]]; then
              echo "::error::pulumi-service-name must be a folder name under infra/stacks, such as agent-harness-service; got '$STACK'."
              exit 1
            fi
            ships_code=$(jq -r --arg stack_path "infra/stacks/$STACK/**" '
              [.services[] | select(.stack_path == $stack_path) | (.deploy_binaries // []) + (.deploy_lambdas // []) | length]
              | add // 0
              | . > 0
            ' .github/services-config.json)
            echo "ships_code=$ships_code" >> "$GITHUB_OUTPUT"
            echo "stack=$STACK ships_code=$ships_code"
        "#})
        .id(CHECK.id())
        .add_env(Env::new("STACK", stack()))
}

fn check_migrations() -> Job {
    steps::check_macro_db_migrations_job(
        &format!("Check {} migrations are applied", stack()),
        &SETUP,
        SETUP.outputs.ships_code.read().is_set(),
    )
}

/// The migration check is skipped for stacks it does not apply to, so proceed
/// as long as nothing actually failed or was cancelled.
fn deploy() -> Job {
    Job::default()
        .needs(vec![SETUP.to_string(), CHECK_MIGRATIONS.to_string()])
        .cond((!failure()).and(!cancelled()))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(deploy_stack())
        .add_step(steps::teardown_nix())
}

fn deploy_stack() -> Step<Use> {
    LocalDeployCloudStoragePulumi::new(
        &format!("Deploy {}", stack()),
        vars::AWS_ACCESS_KEY,
        vars::AWS_SECRET_ACCESS_KEY,
        vars::PULUMI_ACCESS_TOKEN,
        stack(),
        vars::DD_APP_KEY,
        vars::DD_API_KEY,
    )
    .environment(input::<Str>("environment"))
    .cloud_storage_service_name(input::<Str>("cloud-storage-service-name"))
    .step()
}
