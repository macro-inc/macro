//! `Deploy All Services` — the shared cloud-storage deploy pipeline: warm the
//! two shared dep closures onto sticky disks, fan a build matrix out per
//! service (binaries via crane, lambdas via crane + cargo-zigbuild), hand the
//! artifacts off through Namespace artifact storage, run DB migrations, then
//! deploy every service via Pulumi. Called by `deploy_cloud_storage_on_push`
//! (dev) and `release-production` (prod), and manually dispatchable.
//! Generated into `deploy_all_services.yml` (replaces the hand-written
//! `deploy-all-services.yml`).

use anyhow::Result;
use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Run, Step, Strategy, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// The in-VPC self-hosted runner with network access to the databases. Stays
/// off Namespace deliberately — migrations need to reach RDS.
const DB_MIGRATOR_RUNNER: &str = "db-migrator";

/// Build the workflow. The dispatch/call input blocks are filled in by
/// [`patch`].
pub fn deploy_all_services() -> Workflow {
    Workflow::new("Deploy All Services")
        .on(Event::default()
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            // Only run 1 deploy-all workflow at a time per environment.
            // Literal prefix: for workflow_call runs `github.workflow` expands
            // to the *caller's* name, which would split dispatches and callers
            // into separate groups and let them race the same Pulumi stacks.
            // Groups are repo-global strings, so the on-push caller shares
            // this group by using the same literal.
            Concurrency::new(Expression::new(
                "deploy-all-services-${{ inputs.environment }}",
            ))
            .cancel_in_progress(false),
        )
        .add_job("setup", setup())
        .add_job(
            "warm-binaries",
            warm_job(
                "Warm shared binary deps onto sticky disk",
                "binaries",
                "Warm shared release deps",
                "\".#deployCargoArtifacts\"",
                "Shared release deps realised into /nix/store; committed on job exit.",
            ),
        )
        .add_job(
            "warm-lambdas",
            warm_job(
                "Warm shared lambda deps onto sticky disk",
                "lambdas",
                "Warm shared lambda dep closure",
                "\".#lambdaDeployCargoArtifacts\" \".#callRecordingPreviewFfmpegLayer\"",
                "Shared lambda deps realised into /nix/store; committed on job exit.",
            ),
        )
        .add_job("build-service-binaries", build_service_binaries())
        .add_job("build-lambda-artifacts", build_lambda_artifacts())
        .add_job("migrate-db", migrate_db())
        .add_job("deploy-services", deploy_services())
        .add_job("deployment-summary", deployment_summary())
}

/// Fill in the ordered dispatch/call input blocks.
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
                default: 'dev'
                options:
                  - dev
                  - prod
                description: The environment we are deploying to.
        "#})?,
    );
    on.insert(
        "workflow_call".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                type: string
                required: true
                description: The environment we are deploying to.
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

fn setup() -> Job {
    Job::default()
        .name("Setup Deployment Matrix")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("matrix", "${{ steps.set-matrix.outputs.matrix }}")
        .add_output("binaries", "${{ steps.set-matrix.outputs.binaries }}")
        .add_output("lambdas", "${{ steps.set-matrix.outputs.lambdas }}")
        .add_step(steps::checkout_v4())
        .add_step(set_matrix())
}

fn set_matrix() -> Step<Run> {
    Step::new("Set deployment matrix")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            cfg=.github/services-config.json
            # Full list drives deploy-services; the filtered lists keep each build
            # matrix to only the services that actually produce that artifact, so
            # no build job spins up Nix + a cache volume for nothing.
            services=$(jq -c '.services | keys' "$cfg")
            binaries=$(jq -c '[.services | to_entries[] | select((.value.deploy_binaries // []) | length > 0) | .key]' "$cfg")
            lambdas=$(jq -c '[.services | to_entries[] | select((.value.deploy_lambdas // []) | length > 0) | .key]' "$cfg")
            echo "matrix=${services}" >> "$GITHUB_OUTPUT"
            echo "binaries=${binaries}" >> "$GITHUB_OUTPUT"
            echo "lambdas=${lambdas}" >> "$GITHUB_OUTPUT"
            echo "All services: ${services}"
            echo "With binaries: ${binaries}"
            echo "With lambdas: ${lambdas}"
        "#})
        .id("set-matrix")
}

/// Warm one shared dep closure onto the /nix sticky disk. The two warm jobs
/// run in parallel and each build matrix depends only on its own warm job, so
/// a slow lambda-closure warm never blocks binary builds and vice versa. The
/// /nix cache volume is an optimization; Cachix is the consistency backstop
/// either way.
fn warm_job(
    name: &str,
    gate_output: &str,
    build_step_name: &str,
    targets: &str,
    done_msg: &str,
) -> Job {
    Job::default()
        .name(name)
        .needs(vec!["setup".to_string()])
        .cond(Expression::new(format!(
            "${{{{ needs.setup.outputs.{gate_output} != '[]' }}}}"
        )))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_cachix())
        .add_step(steps::nix_build_watched(build_step_name, targets, done_msg))
        .add_step(steps::teardown_nix())
}

/// Base for the per-service build matrix jobs: clones the warm /nix cache
/// volume populated by the matching warm job, so only each service's own
/// crate compiles (cold volume -> Cachix substitution). No max-parallel:
/// runners autoscale, so all services build concurrently.
fn build_job(name: &str, warm_job_id: &str, gate_output: &str) -> Job {
    Job::default()
        .name(name)
        .needs(vec!["setup".to_string(), warm_job_id.to_string()])
        .cond(Expression::new(format!(
            "${{{{ needs.setup.outputs.{gate_output} != '[]' }}}}"
        )))
        .runs_on(runners::Runner::Mid.to_string())
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": format!("${{{{ fromJson(needs.setup.outputs.{gate_output}) }}}}"),
            })),
            max_parallel: None,
        })
        .add_step(steps::checkout_v4().add_with(("clean", false)))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_cachix())
}

fn build_service_binaries() -> Job {
    build_job(
        "Build ${{ matrix.service }} binaries",
        "warm-binaries",
        "binaries",
    )
    .add_step(build_prebuilt_binaries())
    .add_step(steps::upload_handoff_artifact(
        "prebuilt-binaries.tar.gz",
        "${{ matrix.service }}",
    ))
    .add_step(steps::teardown_nix())
}

fn build_prebuilt_binaries() -> Step<Run> {
    let script = steps::with_cachix_watch(indoc::indoc! {r#"
        mkdir -p prebuilt
        nix build --print-build-logs ".#deploy-service-binaries-${SERVICE}"
        cp -r result/bin/* prebuilt/
        mkdir -p prebuilt/nix-store
        while IFS= read -r store_path; do
          cp -a "$store_path" prebuilt/nix-store/
        done < <(nix-store -qR result)
        touch prebuilt/.keep
        tar -C prebuilt -czf prebuilt-binaries.tar.gz .
        # Receipt: the deploy job logs the same hash on read.
        echo "handoff receipt: $(sha256sum prebuilt-binaries.tar.gz | cut -d' ' -f1) ($(stat -c%s prebuilt-binaries.tar.gz) bytes)"
    "#});
    Step::new("Build prebuilt binaries")
        .run(script)
        .shell("bash")
        .add_env(Env::new("SERVICE", "${{ matrix.service }}"))
}

/// Each handler is a crane + cargo-zigbuild nix package. This job builds all
/// of a service's handlers via `nix build .#deploy-lambda-<name>`, cloning the
/// warm lambda /nix disk committed by warm-lambdas. Unchanged handlers are
/// pure cache hits (substituted from the disk/Cachix, no recompile).
fn build_lambda_artifacts() -> Job {
    build_job(
        "Build ${{ matrix.service }} Lambda artifacts",
        "warm-lambdas",
        "lambdas",
    )
    .add_step(build_lambdas())
    .add_step(log_lambda_receipt())
    .add_step(steps::upload_handoff_artifact(
        "lambda-artifacts.tar.gz",
        "${{ matrix.service }}",
    ))
    .add_step(steps::teardown_nix())
}

fn build_lambdas() -> Step<Run> {
    Step::new("Build Lambda artifacts")
        .run(".github/scripts/build-cloud-storage-lambdas-nix.sh")
        .add_env(Env::new("SERVICE", "${{ matrix.service }}"))
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
            "setup".to_string(),
            "warm-binaries".to_string(),
            "warm-lambdas".to_string(),
            "build-service-binaries".to_string(),
            "build-lambda-artifacts".to_string(),
        ])
        .cond(Expression::new(
            "${{ !cancelled() && needs.setup.outputs.matrix != '[]' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}",
        ))
        .runs_on(DB_MIGRATOR_RUNNER)
        .add_step(steps::checkout_v4().add_with(("sparse-checkout", ".github/")))
        .add_step(run_migrations())
}

fn run_migrations() -> Step<Use> {
    steps::uses_local(
        "Run migrations",
        xtask_paths::repo_dir!(".github/actions/migrate-cloud-storage-db"),
    )
    .add_with(("environment", "${{ inputs.environment }}"))
}

/// Deploys via Pulumi + Docker; AWS auth is via explicit static keys
/// (configure-aws-credentials). PULUMI_HOME is pinned to a fixed path (outside
/// the workspace, which the deploy action's checkout cleans) so the plugins
/// subdir can be backed by a sticky disk; it propagates into the composite
/// action's pulumi step via the job env.
fn deploy_services() -> Job {
    Job::default()
        .name("Deploy ${{ matrix.service }}")
        .needs(vec![
            "setup".to_string(),
            "warm-binaries".to_string(),
            "warm-lambdas".to_string(),
            "build-service-binaries".to_string(),
            "build-lambda-artifacts".to_string(),
            "migrate-db".to_string(),
        ])
        .cond(Expression::new(
            "${{ !cancelled() && needs.setup.outputs.matrix != '[]' && needs.migrate-db.result == 'success' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}",
        ))
        .runs_on(runners::Runner::Small.to_string())
        .add_env(("PULUMI_HOME", "/pulumi"))
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": "${{ fromJson(needs.setup.outputs.matrix) }}",
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
    steps::uses_local(
        "Get project name",
        xtask_paths::repo_dir!(".github/actions/get-project-name"),
    )
    .id("project-name")
    .add_with(("service-name", "${{ matrix.service }}"))
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            has_binaries=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_binaries // []) | length) > 0' .github/services-config.json)
            has_lambdas=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_lambdas // []) | length) > 0' .github/services-config.json)
            echo "has_binaries=$has_binaries" >> "$GITHUB_OUTPUT"
            echo "has_lambdas=$has_lambdas" >> "$GITHUB_OUTPUT"
        "#})
        .id("check-artifacts")
        .add_env(Env::new("SERVICE", "${{ matrix.service }}"))
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
        .if_condition(Expression::new(
            "${{ steps.check-artifacts.outputs.has_binaries == 'true' || steps.check-artifacts.outputs.has_lambdas == 'true' }}",
        ))
        .shell("bash")
        .add_env(Env::new(
            "HAS_BINARIES",
            "${{ steps.check-artifacts.outputs.has_binaries }}",
        ))
        .add_env(Env::new(
            "HAS_LAMBDAS",
            "${{ steps.check-artifacts.outputs.has_lambdas }}",
        ))
        .add_env(Env::new(
            "BASE",
            "handoff/${{ github.run_id }}-${{ github.run_attempt }}/${{ matrix.service }}",
        ))
}

fn deploy_service() -> Step<Use> {
    steps::uses_local(
        "Deploy ${{ matrix.service }}",
        xtask_paths::repo_dir!(".github/actions/deploy-cloud-storage-pulumi"),
    )
    .add_with(("environment", "${{ inputs.environment }}"))
    .add_with(("aws-access-key", vars::AWS_ACCESS_KEY))
    .add_with(("aws-secret-key", vars::AWS_SECRET_ACCESS_KEY))
    .add_with(("pulumi-access-token", vars::PULUMI_ACCESS_TOKEN))
    .add_with((
        "pulumi-service-name",
        "${{ steps.project-name.outputs.project-name }}",
    ))
    .add_with(("use-namespace-builder", "true"))
    .add_with((
        "prebuilt-binaries-tar",
        "${{ steps.check-artifacts.outputs.has_binaries == 'true' && format('{0}/handoff/prebuilt-binaries.tar.gz', runner.temp) || '' }}",
    ))
    .add_with((
        "lambda-artifacts-tar",
        "${{ steps.check-artifacts.outputs.has_lambdas == 'true' && format('{0}/handoff/lambda-artifacts.tar.gz', runner.temp) || '' }}",
    ))
    .add_with(("dd-app-key", vars::DD_APP_KEY))
    .add_with(("dd-api-key", vars::DD_API_KEY))
}

fn deployment_summary() -> Job {
    Job::default()
        .name("Deployment Summary")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .needs(vec![
            "setup".to_string(),
            "warm-binaries".to_string(),
            "warm-lambdas".to_string(),
            "build-service-binaries".to_string(),
            "build-lambda-artifacts".to_string(),
            "migrate-db".to_string(),
            "deploy-services".to_string(),
        ])
        .cond(Expression::new("always()"))
        .add_step(check_deployment_results())
}

fn check_deployment_results() -> Step<Run> {
    Step::new("Check deployment results").run(indoc::indoc! {r#"
        if [[ "${{ needs.setup.result }}" == "failure" ]]; then
          echo "❌ Deployment setup failed"
          exit 1
        elif [[ "${{ needs.setup.result }}" == "skipped" ]]; then
          echo "⏭️ Deployment setup was skipped"
        elif [[ "${{ needs.warm-binaries.result }}" == "failure" || "${{ needs.warm-lambdas.result }}" == "failure" ]]; then
          echo "❌ Warming shared deps onto a sticky disk failed"
          exit 1
        elif [[ "${{ needs.build-service-binaries.result }}" == "failure" ]]; then
          echo "❌ One or more service binary builds failed"
          exit 1
        elif [[ "${{ needs.build-lambda-artifacts.result }}" == "failure" ]]; then
          echo "❌ One or more Lambda artifact builds failed"
          exit 1
        elif [[ "${{ needs.migrate-db.result }}" == "failure" ]]; then
          echo "❌ Database migrations failed"
          exit 1
        elif [[ "${{ needs.deploy-services.result }}" == "failure" ]]; then
          echo "❌ One or more service deployments failed"
          exit 1
        elif [[ "${{ needs.deploy-services.result }}" == "skipped" ]]; then
          echo "⏭️ No services to deploy"
        else
          echo "✅ All service deployments completed successfully for $ENVIRONMENT environment"
        fi
    "#})
    .shell("bash")
    .add_env(Env::new("ENVIRONMENT", "${{ inputs.environment }}"))
}
