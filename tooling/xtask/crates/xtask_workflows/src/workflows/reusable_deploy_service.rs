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
//! /nix sticky disk + Cachix still substitute everything unchanged from
//! prior runs).

use anyhow::Result;
use gh_workflow::{Env, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall};

use crate::workflows::{runners, steps, vars};

/// Build the workflow. The `workflow_call` input/secret block is filled in by
/// [`patch`].
pub fn reusable_deploy_service() -> Workflow {
    Workflow::new("Reusable Deploy Service")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("setup", setup())
        .add_job("build-service-binaries", build_service_binaries())
        .add_job("build-lambda-artifacts", build_lambda_artifacts())
        .add_job("deploy", deploy())
}

/// Fill in the ordered `workflow_call` inputs/secrets block.
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
                description: The environment to deploy to
              service-name:
                required: true
                type: string
                description: The name of the service to deploy
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

/// Resolve which artifact kinds this service produces so the heavy nix build
/// jobs only spin up a Namespace runner + /nix volume when there's something
/// to build (mirrors deploy-all-services' matrix filtering, for one service).
fn setup() -> Job {
    Job::default()
        .name("Check ${{ inputs.service-name }} artifacts")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("has_binaries", "${{ steps.check.outputs.has_binaries }}")
        .add_output("has_lambdas", "${{ steps.check.outputs.has_lambdas }}")
        .add_step(steps::checkout_v4().add_with(("sparse-checkout", ".github/")))
        .add_step(check_artifact_config())
}

fn check_artifact_config() -> Step<Run> {
    Step::new("Check artifact config")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            cfg=.github/services-config.json
            has_binaries=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_binaries // []) | length) > 0' "$cfg")
            has_lambdas=$(jq -r --arg service "$SERVICE" '((.services[$service].deploy_lambdas // []) | length) > 0' "$cfg")
            echo "has_binaries=$has_binaries" >> "$GITHUB_OUTPUT"
            echo "has_lambdas=$has_lambdas" >> "$GITHUB_OUTPUT"
            echo "service=$SERVICE binaries=$has_binaries lambdas=$has_lambdas"
        "#})
        .id("check")
        .add_env(Env::new("SERVICE", "${{ inputs.service-name }}"))
}

/// Base for the two nix build jobs: warm /nix volume + Nix + Cachix fallback.
fn build_job(name: &str, gate_output: &str) -> Job {
    Job::default()
        .name(name)
        .needs(vec!["setup".to_string()])
        .cond(Expression::new(format!(
            "${{{{ needs.setup.outputs.{gate_output} == 'true' }}}}"
        )))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4().add_with(("clean", false)))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_cachix())
}

fn build_service_binaries() -> Job {
    build_job("Build ${{ inputs.service-name }} binaries", "has_binaries")
        .add_step(build_prebuilt_binaries())
        .add_step(steps::upload_handoff_artifact(
            "prebuilt-binaries.tar.gz",
            "${{ inputs.service-name }}",
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
        .add_env(Env::new("SERVICE", "${{ inputs.service-name }}"))
}

/// Each handler is a crane + cargo-zigbuild nix package; the build script
/// runs `nix build .#deploy-lambda-<name>` for the service's handlers.
/// Unchanged handlers are pure cache hits (substituted from the /nix disk or
/// Cachix).
fn build_lambda_artifacts() -> Job {
    build_job(
        "Build ${{ inputs.service-name }} Lambda artifacts",
        "has_lambdas",
    )
    .add_step(build_lambdas())
    .add_step(log_lambda_receipt())
    .add_step(steps::upload_handoff_artifact(
        "lambda-artifacts.tar.gz",
        "${{ inputs.service-name }}",
    ))
    .add_step(steps::teardown_nix())
}

fn build_lambdas() -> Step<Run> {
    Step::new("Build Lambda artifacts")
        .run(".github/scripts/build-cloud-storage-lambdas-nix.sh")
        .add_env(Env::new("SERVICE", "${{ inputs.service-name }}"))
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

/// A build job is skipped when the service has no binaries/lambdas (and a
/// service may legitimately have neither). Proceed as long as nothing
/// actually failed or was cancelled — skipped needs are expected here.
/// Deploys via Pulumi + Docker; AWS auth is via explicit static keys.
fn deploy() -> Job {
    Job::default()
        .name("Deploy ${{ inputs.service-name }}")
        .needs(vec![
            "setup".to_string(),
            "build-service-binaries".to_string(),
            "build-lambda-artifacts".to_string(),
        ])
        .cond(Expression::new("${{ !failure() && !cancelled() }}"))
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
    steps::uses_local(
        "Get project name",
        xtask_paths::repo_dir!(".github/actions/get-project-name"),
    )
    .id("project-name")
    .add_with(("service-name", "${{ inputs.service-name }}"))
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
            "${{ needs.setup.outputs.has_binaries == 'true' || needs.setup.outputs.has_lambdas == 'true' }}",
        ))
        .shell("bash")
        .add_env(Env::new(
            "HAS_BINARIES",
            "${{ needs.setup.outputs.has_binaries }}",
        ))
        .add_env(Env::new(
            "HAS_LAMBDAS",
            "${{ needs.setup.outputs.has_lambdas }}",
        ))
        .add_env(Env::new(
            "BASE",
            "handoff/${{ github.run_id }}-${{ github.run_attempt }}/${{ inputs.service-name }}",
        ))
}

fn deploy_service() -> Step<Use> {
    steps::uses_local(
        "Deploy ${{ inputs.service-name }}",
        xtask_paths::repo_dir!(".github/actions/deploy-cloud-storage-pulumi"),
    )
    .add_with(("environment", "${{ inputs.environment }}"))
    .add_with(("aws-access-key", vars::AWS_ACCESS_KEY))
    .add_with(("aws-secret-key", vars::AWS_SECRET_ACCESS_KEY))
    .add_with(("pulumi-access-token", vars::PULUMI_ACCESS_TOKEN))
    .add_with((
        "pulumi-service-name",
        "${{ inputs.pulumi-stack-name || steps.project-name.outputs.project-name }}",
    ))
    .add_with(("use-namespace-builder", "true"))
    .add_with(("use-docker", "${{ inputs.use-docker }}"))
    .add_with(("use-lfs", "${{ inputs.use-lfs }}"))
    .add_with((
        "prebuilt-binaries-tar",
        "${{ needs.setup.outputs.has_binaries == 'true' && format('{0}/handoff/prebuilt-binaries.tar.gz', runner.temp) || '' }}",
    ))
    .add_with((
        "lambda-artifacts-tar",
        "${{ needs.setup.outputs.has_lambdas == 'true' && format('{0}/handoff/lambda-artifacts.tar.gz', runner.temp) || '' }}",
    ))
    .add_with(("dd-app-key", vars::DD_APP_KEY))
    .add_with(("dd-api-key", vars::DD_API_KEY))
}
