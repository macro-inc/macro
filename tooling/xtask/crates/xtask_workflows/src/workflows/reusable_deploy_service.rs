//! `Reusable Deploy Service` — single-service deploy on the shared
//! namespace + nix + crane pipeline: the same warm sticky-disk nix builds,
//! crane/cargo-zigbuild lambdas, nsc artifact handoff, and Namespace Docker
//! builder used by [`crate::workflows::deploy_all_services`], scoped to one
//! service. Generated into `reusable_deploy_service.yml` (replaces the
//! hand-written `reusable-deploy-service.yml`).
//!
//! deploy-all-services warms a shared dep closure once and fans a build
//! matrix out across it; with a single service there is no fan-out to
//! amortise, so the per-service build realises its own closure directly (the
//! /nix sticky disk still substitutes everything unchanged from prior runs).

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, JobHandle, JobOutput, StepHandle, StepOutput, Str, cancelled, failure,
    format, github, input, runner,
};
use gh_workflow::{
    Env, Event, Job, Run, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput,
};

use crate::workflows::actions::{LocalDeployCloudStoragePulumi, LocalGetProjectName};
use crate::workflows::{runners, steps, vars};

pub(crate) struct SetupOutputs {
    /// Whether the service builds binaries.
    pub has_binaries: JobOutput<Flag>,
    /// Whether the service builds lambdas.
    pub has_lambdas: JobOutput<Flag>,
}

/// The job that resolves which artifacts the service builds.
pub(crate) const SETUP: JobHandle<SetupOutputs> = JobHandle::new(
    "setup",
    SetupOutputs {
        has_binaries: JobOutput::new("setup", "has_binaries"),
        has_lambdas: JobOutput::new("setup", "has_lambdas"),
    },
);

pub(crate) struct CheckOutputs {
    /// Whether the service builds binaries.
    pub has_binaries: StepOutput<Flag>,
    /// Whether the service builds lambdas.
    pub has_lambdas: StepOutput<Flag>,
}

/// The step that writes [`SETUP`]'s outputs.
pub(crate) const CHECK: StepHandle<CheckOutputs> = StepHandle::new(
    "check",
    CheckOutputs {
        has_binaries: StepOutput::new("check", "has_binaries"),
        has_lambdas: StepOutput::new("check", "has_lambdas"),
    },
);

pub(crate) const BUILD_SERVICE_BINARIES: JobHandle<()> =
    JobHandle::new("build-service-binaries", ());
pub(crate) const BUILD_LAMBDA_ARTIFACTS: JobHandle<()> =
    JobHandle::new("build-lambda-artifacts", ());
pub(crate) const CHECK_MIGRATIONS: JobHandle<()> = JobHandle::new("check-migrations", ());

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

fn service_name() -> Expr<Str> {
    input("service-name")
}

/// Build the workflow.
pub fn reusable_deploy_service() -> Workflow {
    Workflow::new("Reusable Deploy Service")
        .on(Event::default().workflow_call(
            WorkflowCall::default()
                .add_input(
                    "environment",
                    WorkflowInput::string()
                        .description("The environment to deploy to")
                        .required(true),
                )
                .add_input(
                    "service-name",
                    WorkflowInput::string()
                        .description("The name of the service to deploy")
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
        .add_job(SETUP, setup())
        .add_job(BUILD_SERVICE_BINARIES, build_service_binaries())
        .add_job(BUILD_LAMBDA_ARTIFACTS, build_lambda_artifacts())
        .add_job(CHECK_MIGRATIONS, check_migrations())
        .add_job("deploy", deploy())
}

/// Resolve which artifact kinds this service produces so the heavy nix build
/// jobs only spin up a Namespace runner + /nix volume when there's something
/// to build (mirrors deploy-all-services' matrix filtering, for one service).
fn setup() -> Job {
    Job::default()
        .name(format!("Check {} artifacts", service_name()))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            SETUP.outputs.has_binaries.name(),
            CHECK.outputs.has_binaries.read(),
        )
        .add_output(
            SETUP.outputs.has_lambdas.name(),
            CHECK.outputs.has_lambdas.read(),
        )
        .add_step(steps::checkout_v4_action().sparse_checkout(".github/"))
        .add_step(check_artifact_config())
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            cfg=.github/services-config.json
            if jq -e --arg service "$SERVICE" '.services[$service].bootstrap_pending != null' "$cfg" > /dev/null; then
              reason=$(jq -r --arg service "$SERVICE" '.services[$service].bootstrap_pending' "$cfg")
              echo "::error::Cannot deploy $SERVICE before bootstrap: $reason"
              exit 1
            fi
            has_binaries=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_binaries // []) | length) > 0' "$cfg")
            has_lambdas=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_lambdas // []) | length) > 0' "$cfg")
            echo "has_binaries=$has_binaries" >> "$GITHUB_OUTPUT"
            echo "has_lambdas=$has_lambdas" >> "$GITHUB_OUTPUT"
            echo "service=$SERVICE binaries=$has_binaries lambdas=$has_lambdas"
        "#})
        .id(CHECK.id())
        .add_env(Env::new("SERVICE", service_name()))
}

/// Base for the two Nix build jobs using Namespace's warm `/nix` volume.
fn build_job(name: &str, gate: &JobOutput<Flag>) -> Job {
    Job::default()
        .name(name)
        .needs(vec![SETUP.to_string()])
        .cond(gate.read().is_set())
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4_action().clean(false))
        .add_step(steps::setup_bun_pinned())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
}

fn build_service_binaries() -> Job {
    build_job(
        &format!("Build {} binaries", service_name()),
        &SETUP.outputs.has_binaries,
    )
    .add_step(build_prebuilt_binaries())
    .add_step(steps::upload_handoff_artifact(
        "prebuilt-binaries.tar.gz",
        service_name(),
    ))
    .add_step(steps::teardown_nix())
}

fn build_prebuilt_binaries() -> Step<Run> {
    let script = indoc::indoc! {r#"
        set -euo pipefail
        mkdir -p prebuilt
        # DSS bundles two cargo packages; the hand-written nix.conf leaves
        # max-jobs at 1, which would build them one after the other.
        nix build --max-jobs auto --print-build-logs ".#deploy-service-binaries-${SERVICE}"
        cp -r result/bin/* prebuilt/
        mkdir -p prebuilt/nix-store
        while IFS= read -r store_path; do
          cp -a "$store_path" prebuilt/nix-store/
        done < <(nix-store -qR result)
        touch prebuilt/.keep
        tar -C prebuilt -czf prebuilt-binaries.tar.gz .
        # Receipt: the deploy job logs the same hash on read.
        echo "handoff receipt: $(sha256sum prebuilt-binaries.tar.gz | cut -d' ' -f1) ($(stat -c%s prebuilt-binaries.tar.gz) bytes)"
    "#};
    Step::new("Build prebuilt binaries")
        .run(script)
        .shell("bash")
        .add_env(Env::new("SERVICE", service_name()))
}

/// Each handler is a crane + cargo-zigbuild nix package; the build script
/// runs `nix build .#deploy-lambda-<name>` for the service's handlers.
/// Unchanged handlers are pure cache hits (substituted from the /nix disk or
/// the Namespace Nix cache volume).
fn build_lambda_artifacts() -> Job {
    build_job(
        &format!("Build {} Lambda artifacts", service_name()),
        &SETUP.outputs.has_lambdas,
    )
    .add_step(build_lambdas())
    .add_step(log_lambda_receipt())
    .add_step(steps::upload_handoff_artifact(
        "lambda-artifacts.tar.gz",
        service_name(),
    ))
    .add_step(steps::teardown_nix())
}

fn build_lambdas() -> Step<Run> {
    Step::new("Build Lambda artifacts")
        .run(".github/scripts/build-cloud-storage-lambdas-nix.sh")
        .add_env(Env::new("SERVICE", service_name()))
}

fn log_lambda_receipt() -> Step<Run> {
    Step::new("Log handoff receipt")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            # The build script writes lambda-artifacts.tar.gz to the workspace
            # root; the deploy job logs the same hash on read.
            echo "handoff receipt: $(sha256sum lambda-artifacts.tar.gz | cut -d' ' -f1) ($(stat -c%s lambda-artifacts.tar.gz) bytes)"
        "#})
        .shell("bash")
}

fn check_migrations() -> Job {
    steps::check_macro_db_migrations_job(
        &format!("Check {} migrations are applied", service_name()),
        &SETUP,
        SETUP
            .outputs
            .has_binaries
            .read()
            .is_set()
            .or(SETUP.outputs.has_lambdas.read().is_set()),
    )
}

/// A build or migration-check job is skipped when it does not apply to the
/// service (and a service may legitimately have neither binaries nor lambdas).
/// Proceed as long as nothing actually failed or was cancelled — skipped needs
/// are expected here.
/// Deploys via Pulumi + Docker; AWS auth is via explicit static keys.
fn deploy() -> Job {
    Job::default()
        .name(format!("Deploy {}", service_name()))
        .needs(vec![
            SETUP.to_string(),
            BUILD_SERVICE_BINARIES.to_string(),
            BUILD_LAMBDA_ARTIFACTS.to_string(),
            CHECK_MIGRATIONS.to_string(),
        ])
        .cond((!failure()).and(!cancelled()))
        .runs_on(runners::Runner::Small.to_string())
        .add_env(("PULUMI_HOME", "/pulumi"))
        .add_step(steps::checkout_v4())
        .add_step(get_project_name())
        .add_step(download_handoff_artifacts())
        .add_step(steps::cache_pulumi_plugins())
        .add_step(steps::ensure_pulumi_home_writable())
        .add_step(deploy_service())
}

fn get_project_name() -> Step<Use> {
    LocalGetProjectName::new("Get project name", service_name())
        .step()
        .id(PROJECT_NAME.id())
        .if_condition(input::<Str>("pulumi-stack-name").eq(""))
}

/// Pull the handoff tars from Namespace artifact storage into runner.temp
/// (outside the workspace, which the composite action's checkout cleans).
/// The composite's tar-path branch handles receipts + the extract guard.
fn download_handoff_artifacts() -> Step<Run> {
    Step::new("Download handoff artifacts")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if ! command -v nsc >/dev/null 2>&1; then
              echo "::error::nsc CLI not found — this job expects a Namespace runner (or add namespacelabs/nscloud-setup)"
              exit 1
            fi
            mkdir -p "$RUNNER_TEMP/handoff"
            if [[ "$HAS_BINARIES" == "true" ]]; then
              nsc artifact download "$BASE/prebuilt-binaries.tar.gz" "$RUNNER_TEMP/handoff/prebuilt-binaries.tar.gz"
            fi
            if [[ "$HAS_LAMBDAS" == "true" ]]; then
              nsc artifact download "$BASE/lambda-artifacts.tar.gz" "$RUNNER_TEMP/handoff/lambda-artifacts.tar.gz"
            fi
        "#})
        .if_condition(
            SETUP
                .outputs
                .has_binaries
                .read()
                .is_set()
                .or(SETUP.outputs.has_lambdas.read().is_set()),
        )
        .shell("bash")
        .add_env(Env::new(
            "HAS_BINARIES",
            SETUP.outputs.has_binaries.read(),
        ))
        .add_env(Env::new(
            "HAS_LAMBDAS",
            SETUP.outputs.has_lambdas.read(),
        ))
        .add_env(Env::new(
            "BASE",
            format!(
                "handoff/{}-{}/{}",
                github().run_id(),
                github().run_attempt(),
                service_name()
            ),
        ))
}

fn deploy_service() -> Step<Use> {
    LocalDeployCloudStoragePulumi::new(
        &format!("Deploy {}", service_name()),
        vars::AWS_ACCESS_KEY,
        vars::AWS_SECRET_ACCESS_KEY,
        vars::PULUMI_ACCESS_TOKEN,
        input::<Str>("pulumi-stack-name").or_else(PROJECT_NAME.outputs.project_name.read()),
        vars::DD_APP_KEY,
        vars::DD_API_KEY,
    )
    .environment(input::<Str>("environment"))
    .use_namespace_builder("true")
    .use_docker(input::<Bool>("use-docker"))
    .use_lfs(input::<Bool>("use-lfs"))
    .prebuilt_binaries_tar(handoff_tar_path(
        &SETUP.outputs.has_binaries,
        "prebuilt-binaries.tar.gz",
    ))
    .lambda_artifacts_tar(handoff_tar_path(
        &SETUP.outputs.has_lambdas,
        "lambda-artifacts.tar.gz",
    ))
    .step()
}

/// The downloaded handoff tar when the service has one, else empty.
fn handoff_tar_path(has: &JobOutput<Flag>, file: &str) -> Expr<Str> {
    has.read().is_set().then_else(
        format(
            &format!("{{0}}/handoff/{file}"),
            [runner().temp().into_ast()],
        ),
        "",
    )
}
