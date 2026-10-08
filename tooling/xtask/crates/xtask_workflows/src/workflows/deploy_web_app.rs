//! `Deploy Web App` — builds apps/web (via [`crate::workflows::build_web_app`])
//! and deploys it via the web-app pulumi stack; reusable (workflow_call) and
//! manually dispatchable. A caller that already ran the build in the same run
//! passes `prebuilt: true` to skip straight to the upload. Generated into
//! `deploy_web_app.yml` (replaces the hand-written `deploy-web-app.yml`;
//! dispatch identity is the workflow *name*, so the rename doesn't affect
//! anyone's dispatch habits).

use anyhow::Result;
use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};

use crate::workflows::{build_web_app, runners, steps, vars};

/// Build the workflow. The `workflow_dispatch`/`workflow_call` input blocks
/// are filled in by [`patch`] (choice options + ordered maps).
pub fn deploy_web_app() -> Workflow {
    Workflow::new("Deploy Web App")
        .on(Event::default()
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            // Serialize deploys per *environment*, with a literal prefix: for
            // workflow_call runs `github.workflow` expands to the caller's
            // name, so the hand-written `${{ github.workflow }}-web-app-…`
            // group split push-triggered and manually dispatched deploys into
            // different groups and let them race the same pulumi stack (same
            // fix as deploy-all-services). Never cancel in-progress — that
            // could leave the stack half-applied.
            Concurrency::new(Expression::new("deploy-web-app-${{ inputs.environment }}"))
                .cancel_in_progress(false),
        )
        .add_job("build", build())
        .add_job("deploy", deploy())
}

/// Fill in the ordered dispatch/call input blocks and the build call's
/// `with:`/`secrets:`.
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
                required: true
                type: choice
                options:
                  - dev
                  - prod
                description: The environment to build for
              notify:
                required: false
                type: boolean
                description: Whether to notify the Slack channel of the deployment completion
        "#})?,
    );
    on.insert(
        "workflow_call".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                required: true
                type: string
                description: The environment to build for. e.g. (dev, prod)
              notify:
                required: false
                type: boolean
              prebuilt:
                required: false
                type: boolean
                default: false
                description: The caller already ran build_web_app.yml in this run
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
              SEGMENT_WRITE_KEY:
                required: true
              POSTHOG_API_KEY:
                required: true
        "#})?,
    );

    let build = crate::workflows::job_mut(root, "build")?;
    build.remove("runs-on");
    build.insert(
        "with".into(),
        crate::workflows::yaml_fragment("environment: ${{ inputs.environment }}")?,
    );
    build.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            SEGMENT_WRITE_KEY: ${{ secrets.SEGMENT_WRITE_KEY }}
            POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
        "#})?,
    );
    Ok(())
}

/// `inputs.prebuilt` is unset under workflow_dispatch, so dispatches build.
fn build() -> Job {
    Job::default()
        .name("Build")
        .cond(Expression::new("${{ !inputs.prebuilt }}"))
        .uses("./.github/workflows/build_web_app.yml")
}

/// Runs after either this run's build or the caller's: a skipped build means
/// `prebuilt`, but the default `success()` would skip this job with it.
fn deploy() -> Job {
    Job::default()
        .name("Deploy")
        .needs(vec!["build".to_string()])
        .cond(Expression::new(
            "${{ !cancelled() && (needs.build.result == 'success' || needs.build.result == 'skipped') }}",
        ))
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_step(build_web_app::checkout())
        .add_step(steps::mount_web_build_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(download_dist())
        .add_step(install_infra_dependencies())
        .add_step(configure_aws_credentials())
        .add_step(pulumi_up())
        .add_step(upload_sourcemaps())
        .add_step(upload_production_build())
        .add_step(steps::teardown_nix())
}

fn download_dist() -> Step<Use> {
    Step::new("Download dist")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("name", build_web_app::ARTIFACT))
        .add_with(("path", xtask_paths::runtime_path!("apps/web/dist").as_str()))
}

fn install_infra_dependencies() -> Step<Run> {
    Step::new("Install infra dependencies")
        .run("bun install")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

fn configure_aws_credentials() -> Step<Use> {
    Step::new("Configure AWS Credentials")
        .uses(
            "aws-actions",
            "configure-aws-credentials",
            "e7f100cf4c008499ea8adda475de1042d6975c7b",
        ) // v5
        .add_with(("aws-access-key-id", vars::AWS_ACCESS_KEY))
        .add_with(("aws-secret-access-key", vars::AWS_SECRET_ACCESS_KEY))
        .add_with(("aws-region", "us-east-1"))
}

fn pulumi_up() -> Step<Use> {
    Step::new("Deploy with Pulumi")
        .uses(
            "pulumi",
            "actions",
            "8e5e406f4007fca908480587cb9893c07090f58d",
        ) // v6
        .add_with(("command", "up"))
        .add_with(("stack-name", "macro-inc/${{ inputs.environment }}"))
        .add_with(("work-dir", "./infra/stacks/web-app"))
        .add_env(Env::new("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
        .add_env(Env::new("DD_APP_KEY", vars::DD_APP_KEY))
        .add_env(Env::new("DD_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DD_HOST", "https://api.us5.datadoghq.com/"))
}

fn upload_sourcemaps() -> Step<Run> {
    Step::new("Upload sourcemaps to Datadog")
        .run("bun run ddupload:${{ inputs.environment }}")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("DATADOG_API_KEY", vars::DD_API_KEY))
        .add_env(Env::new("DATADOG_SITE", "us5.datadoghq.com"))
        .add_env(Env::new("DATADOG_API_HOST", "api.us5.datadoghq.com"))
}

fn upload_production_build() -> Step<Use> {
    Step::new("Upload production build")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .if_condition(Expression::new("${{ inputs.environment == 'prod' }}"))
        .add_with(("name", "web-app-build"))
        .add_with(("path", xtask_paths::runtime_path!("apps/web/dist").as_str()))
        .add_with(("overwrite", true))
}
