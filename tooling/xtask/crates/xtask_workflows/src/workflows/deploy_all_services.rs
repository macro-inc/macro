//! `Deploy All Services` — the shared cloud-storage deploy pipeline: warm the
//! two shared dep closures onto sticky disks, fan a build matrix out per
//! service (binaries via crane, lambdas via crane + cargo-zigbuild), hand the
//! artifacts off through Namespace artifact storage, run DB migrations, then
//! deploy every service via Pulumi. Called by `deploy_on_push`
//! (dev) and `release-production` (prod), and manually dispatchable.
//! Generated into `deploy_all_services.yml` (replaces the hand-written
//! `deploy-all-services.yml`).

use gh_workflow::expr::typed::{
    Expr, Flag, JobHandle, JobOutput, Json, StepHandle, StepOutput, Str, all_needs_results, always,
    cancelled, format, from_json, github, input, matrix, runner, to_json, whole_needs,
};
use gh_workflow::{
    Concurrency, Env, Event, Job, Run, Step, Strategy, Use, Workflow, WorkflowCall,
    WorkflowCallSecret, WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::{
    LocalDeployCloudStoragePulumi, LocalGetProjectName, LocalMigrateCloudStorageDb,
};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

pub(crate) struct SetupOutputs {
    /// Every enabled service, as a JSON array.
    pub services: JobOutput<Str>,
    /// The enabled services that build binaries, as a JSON array.
    pub binary_services: JobOutput<Str>,
    /// The enabled services that build lambdas, as a JSON array.
    pub lambda_services: JobOutput<Str>,
}

/// The job that lists which services to build and deploy.
pub(crate) const SETUP: JobHandle<SetupOutputs> = JobHandle::new(
    "setup",
    SetupOutputs {
        services: JobOutput::new("setup", "matrix"),
        binary_services: JobOutput::new("setup", "binaries"),
        lambda_services: JobOutput::new("setup", "lambdas"),
    },
);

pub(crate) struct SetMatrixOutputs {
    /// Every enabled service, as a JSON array.
    pub services: StepOutput<Str>,
    /// The enabled services that build binaries, as a JSON array.
    pub binary_services: StepOutput<Str>,
    /// The enabled services that build lambdas, as a JSON array.
    pub lambda_services: StepOutput<Str>,
}

/// The step that writes [`SETUP`]'s outputs.
pub(crate) const SET_MATRIX: StepHandle<SetMatrixOutputs> = StepHandle::new(
    "set-matrix",
    SetMatrixOutputs {
        services: StepOutput::new("set-matrix", "matrix"),
        binary_services: StepOutput::new("set-matrix", "binaries"),
        lambda_services: StepOutput::new("set-matrix", "lambdas"),
    },
);

pub(crate) const WARM_BINARIES: JobHandle<()> = JobHandle::new("warm-binaries", ());
pub(crate) const WARM_LAMBDAS: JobHandle<()> = JobHandle::new("warm-lambdas", ());
pub(crate) const BUILD_SERVICE_BINARIES: JobHandle<()> =
    JobHandle::new("build-service-binaries", ());
pub(crate) const BUILD_LAMBDA_ARTIFACTS: JobHandle<()> =
    JobHandle::new("build-lambda-artifacts", ());
pub(crate) const MIGRATE_DB: JobHandle<()> = JobHandle::new("migrate-db", ());
pub(crate) const DEPLOY_SERVICES: JobHandle<()> = JobHandle::new("deploy-services", ());

pub(crate) struct CheckArtifactsOutputs {
    /// Whether the matrix service builds binaries.
    pub has_binaries: StepOutput<Flag>,
    /// Whether the matrix service builds lambdas.
    pub has_lambdas: StepOutput<Flag>,
}

/// The step that reads which artifacts the matrix service builds.
pub(crate) const CHECK_ARTIFACTS: StepHandle<CheckArtifactsOutputs> = StepHandle::new(
    "check-artifacts",
    CheckArtifactsOutputs {
        has_binaries: StepOutput::new("check-artifacts", "has_binaries"),
        has_lambdas: StepOutput::new("check-artifacts", "has_lambdas"),
    },
);

pub(crate) struct ProjectNameOutputs {
    /// The matrix service's Pulumi project name.
    pub project_name: StepOutput<Str>,
}

/// The step that resolves the matrix service's Pulumi project.
pub(crate) const PROJECT_NAME: StepHandle<ProjectNameOutputs> = StepHandle::new(
    "project-name",
    ProjectNameOutputs {
        project_name: LocalGetProjectName::project_name_output("project-name"),
    },
);

/// Build the workflow.
pub fn deploy_all_services() -> Workflow {
    Workflow::new("Deploy All Services")
        .on(Event::default()
            .workflow_dispatch(
                WorkflowDispatch::default().add_input(
                    "environment",
                    WorkflowInput::choice(["dev", "prod"])
                        .description("The environment we are deploying to.")
                        .required(true)
                        .default("dev"),
                ),
            )
            .workflow_call(
                WorkflowCall::default()
                    .add_input(
                        "environment",
                        WorkflowInput::string()
                            .description("The environment we are deploying to.")
                            .required(true),
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
                    .add_secret("DD_API_KEY", WorkflowCallSecret::default().required(true))
                    .add_secret(
                        "NIX_CACHE_SIGNING_KEY",
                        WorkflowCallSecret::default().required(false),
                    ),
            ))
        .concurrency(
            // Only run 1 deploy-all workflow at a time per environment.
            // Literal prefix: for workflow_call runs `github.workflow` expands
            // to the *caller's* name, which would split dispatches and callers
            // into separate groups and let them race the same Pulumi stacks.
            // Groups are repo-global strings, so the on-push caller shares
            // this group by using the same literal.
            Concurrency::new(format!(
                "deploy-all-services-{}",
                input::<Str>("environment")
            ))
            .cancel_in_progress(false),
        )
        .add_job(SETUP, setup())
        .add_job(
            WARM_BINARIES,
            warm_job(
                "Warm shared binary deps onto sticky disk",
                &SETUP.outputs.binary_services,
                "Warm shared release deps",
                ".#deployCargoArtifacts",
                "Shared release deps realised into /nix/store; committed on job exit.",
            ),
        )
        .add_job(
            WARM_LAMBDAS,
            warm_job(
                "Warm shared lambda deps onto sticky disk",
                &SETUP.outputs.lambda_services,
                "Warm shared lambda dep closure",
                ".#lambdaDeployCargoArtifacts .#callRecordingPreviewFfmpegLayer",
                "Shared lambda deps realised into /nix/store; committed on job exit.",
            ),
        )
        .add_job(BUILD_SERVICE_BINARIES, build_service_binaries())
        .add_job(BUILD_LAMBDA_ARTIFACTS, build_lambda_artifacts())
        .add_job(MIGRATE_DB, migrate_db())
        .add_job(DEPLOY_SERVICES, deploy_services())
        .add_job("deployment-summary", deployment_summary())
}

fn setup() -> Job {
    Job::default()
        .name("Setup Deployment Matrix")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            SETUP.outputs.services.name(),
            SET_MATRIX.outputs.services.read(),
        )
        .add_output(
            SETUP.outputs.binary_services.name(),
            SET_MATRIX.outputs.binary_services.read(),
        )
        .add_output(
            SETUP.outputs.lambda_services.name(),
            SET_MATRIX.outputs.lambda_services.read(),
        )
        .add_step(steps::checkout_v4())
        .add_step(set_matrix())
}

fn set_matrix() -> Step<Run> {
    Step::new("Set deployment matrix")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            cfg=.github/services-config.json
            # Enabled services drive deploy-services; the filtered lists keep each
            # build matrix to only enabled services that produce that artifact, so
            # disabled/unbootstrapped services and empty artifact jobs consume no runners.
            services=$(jq -c '[.services | to_entries[] | select(.value.deploy_enabled != false and .value.bootstrap_pending == null) | .key]' "$cfg")
            binaries=$(jq -c '[.services | to_entries[] | select(.value.deploy_enabled != false and .value.bootstrap_pending == null) | select((.value.deploy_binaries // []) | length > 0) | .key]' "$cfg")
            lambdas=$(jq -c '[.services | to_entries[] | select(.value.deploy_enabled != false and .value.bootstrap_pending == null) | select((.value.deploy_lambdas // []) | length > 0) | .key]' "$cfg")
            echo "matrix=${services}" >> "$GITHUB_OUTPUT"
            echo "binaries=${binaries}" >> "$GITHUB_OUTPUT"
            echo "lambdas=${lambdas}" >> "$GITHUB_OUTPUT"
            echo "All services: ${services}"
            echo "With binaries: ${binaries}"
            echo "With lambdas: ${lambdas}"
        "#})
        .id(SET_MATRIX.id())
}

/// Warm one shared dep closure onto the /nix sticky disk, then push it to the
/// S3 binary cache so every matrix job that drew a cold/stale volume from the
/// pool can substitute it instead of rebuilding. The two warm jobs run in
/// parallel and each build matrix depends only on its own warm job, so a slow
/// lambda-closure warm never blocks binary builds and vice versa. The /nix
/// cache volume is provided by Namespace's native Nix integration.
fn warm_job(
    name: &str,
    gate: &JobOutput<Str>,
    build_step_name: &str,
    targets: &str,
    done_msg: &str,
) -> Job {
    let quoted_targets = targets
        .split_whitespace()
        .map(|t| format!("\"{t}\""))
        .collect::<Vec<_>>()
        .join(" ");
    Job::default()
        .name(name)
        .needs(vec![SETUP.to_string()])
        .cond(gate.read().ne("[]"))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::nix_build(build_step_name, &quoted_targets, done_msg))
        .add_step(steps::push_nix_cache(targets))
        .add_step(steps::teardown_nix())
}

/// Base for the per-service build matrix jobs: clones the warm /nix cache
/// volume populated by the matching warm job, so only each service's own
/// crate compiles. No max-parallel:
/// runners autoscale, so all services build concurrently.
fn build_job(name: &str, warm_job: &JobHandle<()>, gate: &JobOutput<Str>) -> Job {
    Job::default()
        .name(name)
        .needs(vec![SETUP.to_string(), warm_job.to_string()])
        .cond(gate.read().ne("[]"))
        .runs_on(runners::Runner::Mid.to_string())
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": serde_json::Value::from(from_json::<Json>(gate.read())),
            })),
            max_parallel: None,
        })
        .add_step(steps::checkout_v4_action().clean(false))
        .add_step(steps::setup_bun_pinned())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
}

fn build_service_binaries() -> Job {
    build_job(
        &format!("Build {} binaries", matrix::<Str>("service")),
        &WARM_BINARIES,
        &SETUP.outputs.binary_services,
    )
    .add_step(build_prebuilt_binaries())
    // Pushing the built output is what makes this service a pure substitution
    // next run when it is unchanged, even on a cold volume.
    .add_step(steps::push_nix_cache(&format!(
        ".#deploy-service-binaries-{}",
        matrix::<Str>("service")
    )))
    .add_step(steps::upload_handoff_artifact(
        "prebuilt-binaries.tar.gz",
        matrix("service"),
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
        .add_env(Env::new("SERVICE", matrix::<Str>("service")))
}

/// Each handler is a crane + cargo-zigbuild nix package. This job builds all
/// of a service's handlers via `nix build .#deploy-lambda-<name>`, cloning the
/// warm lambda /nix disk committed by warm-lambdas. Unchanged handlers are
/// pure cache hits from the Namespace Nix volume (no recompile).
fn build_lambda_artifacts() -> Job {
    build_job(
        &format!("Build {} Lambda artifacts", matrix::<Str>("service")),
        &WARM_LAMBDAS,
        &SETUP.outputs.lambda_services,
    )
    .add_step(build_lambdas())
    .add_step(log_lambda_receipt())
    .add_step(steps::upload_handoff_artifact(
        "lambda-artifacts.tar.gz",
        matrix("service"),
    ))
    .add_step(steps::teardown_nix())
}

fn build_lambdas() -> Step<Run> {
    // The cache env lets the script push the handler out-paths it just built
    // (see the script's push block) — the store-path equivalent of the binary
    // job's push step, minus a second flake evaluation.
    Step::new("Build Lambda artifacts")
        .run(".github/scripts/build-cloud-storage-lambdas-nix.sh")
        .add_env(Env::new("SERVICE", matrix::<Str>("service")))
        .add_env(Env::new("NIX_CACHE_URL", vars::NIX_CACHE_URL))
        .add_env(Env::new(
            "NIX_CACHE_SIGNING_KEY",
            vars::NIX_CACHE_SIGNING_KEY,
        ))
        .add_env(Env::new("AWS_ACCESS_KEY_ID", vars::AWS_ACCESS_KEY))
        .add_env(Env::new(
            "AWS_SECRET_ACCESS_KEY",
            vars::AWS_SECRET_ACCESS_KEY,
        ))
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

fn migrate_db() -> Job {
    Job::default()
        .name("Run Database Migrations")
        .needs(vec![
            SETUP.to_string(),
            WARM_BINARIES.to_string(),
            WARM_LAMBDAS.to_string(),
            BUILD_SERVICE_BINARIES.to_string(),
            BUILD_LAMBDA_ARTIFACTS.to_string(),
        ])
        .cond(
            (!cancelled())
                .and(SETUP.outputs.services.read().ne("[]"))
                .and(!all_needs_results().contains("failure"))
                .and(!all_needs_results().contains("cancelled")),
        )
        .runs_on(runners::DB_MIGRATOR)
        .add_step(steps::checkout_v4_action().sparse_checkout(".github/"))
        .add_step(run_migrations())
}

fn run_migrations() -> Step<Use> {
    LocalMigrateCloudStorageDb::new("Run migrations", input::<Str>("environment")).step()
}

/// Deploys via Pulumi + Docker; AWS auth is via explicit static keys
/// (configure-aws-credentials). PULUMI_HOME is pinned to a fixed path (outside
/// the workspace, which the deploy action's checkout cleans) so the plugins
/// subdir can be backed by a sticky disk; it propagates into the composite
/// action's pulumi step via the job env.
fn deploy_services() -> Job {
    Job::default()
        .name(format!("Deploy {}", matrix::<Str>("service")))
        .needs(vec![
            SETUP.to_string(),
            WARM_BINARIES.to_string(),
            WARM_LAMBDAS.to_string(),
            BUILD_SERVICE_BINARIES.to_string(),
            BUILD_LAMBDA_ARTIFACTS.to_string(),
            MIGRATE_DB.to_string(),
        ])
        .cond(
            (!cancelled())
                .and(SETUP.outputs.services.read().ne("[]"))
                .and(MIGRATE_DB.result().eq("success"))
                .and(!all_needs_results().contains("failure"))
                .and(!all_needs_results().contains("cancelled")),
        )
        .runs_on(runners::Runner::Small.to_string())
        .add_env(("PULUMI_HOME", "/pulumi"))
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": serde_json::Value::from(from_json::<Json>(SETUP.outputs.services.read())),
            })),
            max_parallel: None,
        })
        .add_step(steps::checkout_v4())
        .add_step(get_project_name())
        .add_step(check_artifact_config())
        .add_step(download_handoff_artifacts())
        .add_step(steps::cache_pulumi_plugins())
        .add_step(steps::ensure_pulumi_home_writable())
        .add_step(deploy_service())
}

fn get_project_name() -> Step<Use> {
    LocalGetProjectName::new("Get project name", matrix::<Str>("service"))
        .step()
        .id(PROJECT_NAME.id())
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            has_binaries=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_binaries // []) | length) > 0' .github/services-config.json)
            has_lambdas=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_lambdas // []) | length) > 0' .github/services-config.json)
            echo "has_binaries=$has_binaries" >> "$GITHUB_OUTPUT"
            echo "has_lambdas=$has_lambdas" >> "$GITHUB_OUTPUT"
        "#})
        .id(CHECK_ARTIFACTS.id())
        .add_env(Env::new("SERVICE", matrix::<Str>("service")))
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
            CHECK_ARTIFACTS
                .outputs
                .has_binaries
                .read()
                .is_set()
                .or(CHECK_ARTIFACTS.outputs.has_lambdas.read().is_set()),
        )
        .shell("bash")
        .add_env(Env::new(
            "HAS_BINARIES",
            CHECK_ARTIFACTS.outputs.has_binaries.read(),
        ))
        .add_env(Env::new(
            "HAS_LAMBDAS",
            CHECK_ARTIFACTS.outputs.has_lambdas.read(),
        ))
        .add_env(Env::new(
            "BASE",
            format!(
                "handoff/{}-{}/{}",
                github().run_id(),
                github().run_attempt(),
                matrix::<Str>("service")
            ),
        ))
}

fn deploy_service() -> Step<Use> {
    LocalDeployCloudStoragePulumi::new(
        &format!("Deploy {}", matrix::<Str>("service")),
        vars::AWS_ACCESS_KEY,
        vars::AWS_SECRET_ACCESS_KEY,
        vars::PULUMI_ACCESS_TOKEN,
        PROJECT_NAME.outputs.project_name.read(),
        vars::DD_APP_KEY,
        vars::DD_API_KEY,
    )
    .environment(input::<Str>("environment"))
    .use_namespace_builder("true")
    .prebuilt_binaries_tar(handoff_tar_path(
        &CHECK_ARTIFACTS.outputs.has_binaries,
        "prebuilt-binaries.tar.gz",
    ))
    .lambda_artifacts_tar(handoff_tar_path(
        &CHECK_ARTIFACTS.outputs.has_lambdas,
        "lambda-artifacts.tar.gz",
    ))
    .step()
}

/// The downloaded handoff tar when the service has one, else empty.
fn handoff_tar_path(has: &StepOutput<Flag>, file: &str) -> Expr<Str> {
    has.read().is_set().then_else(
        format(
            &format!("{{0}}/handoff/{file}"),
            [runner().temp().into_ast()],
        ),
        "",
    )
}

fn deployment_summary() -> Job {
    Job::default()
        .name("Deployment Summary")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .needs(vec![
            SETUP.to_string(),
            WARM_BINARIES.to_string(),
            WARM_LAMBDAS.to_string(),
            BUILD_SERVICE_BINARIES.to_string(),
            BUILD_LAMBDA_ARTIFACTS.to_string(),
            MIGRATE_DB.to_string(),
            DEPLOY_SERVICES.to_string(),
        ])
        .cond(always())
        .add_step(steps::checkout_v4())
        .add_step(steps::setup_bun_pinned())
        .add_step(check_deployment_results())
}

fn check_deployment_results() -> Step<Run> {
    Step::new("Check deployment results")
        .run("bun .github/scripts/check-service-deployment-results.ts")
        .shell("bash")
        // The whole `needs` context has no builder.
        .add_env(("DEPLOYMENT_NEEDS", to_json(whole_needs())))
}
