//! `Deploy All Services` — the shared cloud-storage deploy pipeline: run DB
//! migrations while warming the two shared dep closures onto sticky disks,
//! then fan out one [`crate::workflows::reusable_deploy_service`] call per
//! service, which builds that service (binaries via crane, lambdas via crane +
//! cargo-zigbuild) and deploys it via Pulumi as soon as its own builds finish.
//! Called by `deploy_on_push`
//! (dev) and `release-production` (prod), and manually dispatchable.
//! Generated into `deploy_all_services.yml` (replaces the hand-written
//! `deploy-all-services.yml`).

use anyhow::Result;
use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Run, Step, Strategy, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

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
                ".#deployCargoArtifacts",
                "Shared release deps realised into /nix/store; committed on job exit.",
            ),
        )
        .add_job(
            "warm-lambdas",
            warm_job(
                "Warm shared lambda deps onto sticky disk",
                "lambdas",
                "Warm shared lambda dep closure",
                ".#lambdaDeployCargoArtifacts .#callRecordingPreviewFfmpegLayer",
                "Shared lambda deps realised into /nix/store; committed on job exit.",
            ),
        )
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
              NIX_CACHE_SIGNING_KEY:
                required: false
        "#})?,
    );

    // `Job::default()` injects `runs-on`, which is invalid alongside `uses:`.
    let deploy = crate::workflows::job_mut(root, "deploy-services")?;
    deploy.remove("runs-on");
    deploy.insert(
        "with".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            environment: ${{ inputs.environment }}
            service-name: ${{ matrix.service }}
        "#})?,
    );
    deploy.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
            AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
            DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
            DD_API_KEY: ${{ secrets.DD_API_KEY }}
            NIX_CACHE_SIGNING_KEY: ${{ secrets.NIX_CACHE_SIGNING_KEY }}
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
        .id("set-matrix")
}

/// Warm one shared dep closure onto the /nix sticky disk, then push it to the
/// S3 binary cache so every matrix job that drew a cold/stale volume from the
/// pool can substitute it instead of rebuilding. The two warm jobs run in
/// parallel and each build matrix depends only on its own warm job, so a slow
/// lambda-closure warm never blocks binary builds and vice versa. The /nix
/// cache volume is provided by Namespace's native Nix integration.
fn warm_job(
    name: &str,
    gate_output: &str,
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
        .needs(vec!["setup".to_string()])
        .cond(Expression::new(format!(
            "${{{{ needs.setup.outputs.{gate_output} != '[]' }}}}"
        )))
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::nix_build(build_step_name, &quoted_targets, done_msg))
        .add_step(steps::push_nix_cache(targets))
        .add_step(steps::teardown_nix())
}

/// Migrations need only the source tree, so they run alongside the warm jobs
/// and are done before any service build finishes. They may land even when a
/// build later fails; that is safe because every migration must already work
/// with the code still running, which serves traffic until its deploy ends.
fn migrate_db() -> Job {
    Job::default()
        .name("Run Database Migrations")
        .needs(vec!["setup".to_string()])
        .cond(Expression::new(
            "${{ !cancelled() && needs.setup.outputs.matrix != '[]' && needs.setup.result == 'success' }}",
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

/// One reusable-workflow call per service: each builds its own binaries and
/// lambdas, then deploys as soon as those finish, without waiting on the other
/// services' builds. A failed build fails only its own service — the same
/// partial-deploy outcome as one failed Pulumi deploy, which the matrix has
/// always tolerated (`fail-fast: false`). Both warm jobs gate every service:
/// they run in parallel and finish within a minute of each other.
fn deploy_services() -> Job {
    Job::default()
        .name("${{ matrix.service }}")
        .needs(vec![
            "setup".to_string(),
            "warm-binaries".to_string(),
            "warm-lambdas".to_string(),
            "migrate-db".to_string(),
        ])
        .cond(Expression::new(
            "${{ !cancelled() && needs.setup.outputs.matrix != '[]' && needs.migrate-db.result == 'success' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}",
        ))
        .strategy(Strategy {
            fail_fast: Some(false),
            matrix: Some(serde_json::json!({
                "service": "${{ fromJson(needs.setup.outputs.matrix) }}",
            })),
            max_parallel: None,
        })
        .uses("./.github/workflows/reusable_deploy_service.yml")
}

fn deployment_summary() -> Job {
    Job::default()
        .name("Deployment Summary")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .needs(vec![
            "setup".to_string(),
            "warm-binaries".to_string(),
            "warm-lambdas".to_string(),
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
        elif [[ "${{ needs.migrate-db.result }}" == "failure" ]]; then
          echo "❌ Database migrations failed"
          exit 1
        elif [[ "${{ needs.deploy-services.result }}" == "failure" ]]; then
          echo "❌ One or more services failed to build or deploy"
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
