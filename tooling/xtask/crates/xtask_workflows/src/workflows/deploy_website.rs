//! `Deploy Website` — builds the public site (`apps/marketing`) and publishes
//! it through the `website-infra` pulumi stack (`infra/stacks/website`), which
//! also owns the macro.com CloudFront distribution that fronts `/app`.
//! Generated into `deploy_website.yml`.
//!
//! Push to `main` (path-gated) auto-deploys `dev`; prod deploys come through
//! `release-production`, which calls this workflow with `environment: prod` —
//! the same split [`crate::workflows::deploy_ai_editing_worker`] uses. Manual
//! `workflow_dispatch` picks `dev`, `prod`, or `both` (dev, then prod).
//!
//! Replaces the `deploy-dev.yml` / `deploy-prod.yml` workflows in the old
//! `macro-inc/solid-site` repository.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Push, Run, Step, Strategy, Use, Workflow,
    WorkflowCall, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// The environments to deploy, as a JSON list. On push `inputs.environment` is
/// empty, so push runs deploy `dev`; `both` deploys dev before prod.
const ENVIRONMENTS: &str = r#"${{ fromJSON(inputs.environment == 'both' && '["dev","prod"]' || format('["{0}"]', inputs.environment || 'dev')) }}"#;

/// The environment of the current matrix leg.
const ENVIRONMENT: &str = "${{ matrix.environment }}";

/// Build the workflow. The `workflow_dispatch`/`workflow_call` input blocks
/// are filled in by [`patch`].
pub fn deploy_website() -> Workflow {
    Workflow::new("Deploy Website")
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/deploy_website.yml"
                    ))
                    .add_path(xtask_paths::repo_glob!("bun.lock"))
                    .add_path(xtask_paths::repo_glob!("apps/marketing/**"))
                    .add_path(xtask_paths::repo_glob!("infra/stacks/website/**")),
            )
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .add_job("build-deploy", build_deploy())
}

/// Input blocks `gh_workflow` cannot express: a `choice` dispatch input, and the
/// `workflow_call` contract `release-production` deploys prod through.
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
                description: The environment to deploy to. e.g. (dev, prod, both)
            secrets:
              AWS_ACCESS_KEY:
                required: true
              AWS_SECRET_ACCESS_KEY:
                required: true
              PULUMI_ACCESS_TOKEN:
                required: true
        "#})?,
    );
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                required: true
                type: choice
                default: 'dev'
                options:
                  - dev
                  - prod
                  - both
                description: The environment to deploy to (both deploys dev, then prod)
        "#})?,
    );
    Ok(())
}

fn build_deploy() -> Job {
    Job::default()
        .name("Build and Deploy Website")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        // One leg at a time, in list order: with fail-fast, a failed dev deploy
        // cancels the queued prod leg.
        .strategy(Strategy {
            matrix: Some(serde_json::json!({ "environment": ENVIRONMENTS })),
            fail_fast: Some(true),
            max_parallel: Some(1),
        })
        // Per environment, so a `both` run still serializes with push and
        // release deploys of the same stack. Literal prefix rather than
        // `github.workflow`, which expands to the *caller's* name for
        // workflow_call runs. Never cancel in-progress — that could leave the
        // stack half-applied.
        .concurrency(
            Concurrency::new(Expression::new(format!("deploy-website-{ENVIRONMENT}")))
                .cancel_in_progress(false),
        )
        .add_env(("CI", "true"))
        .add_step(checkout())
        .add_step(verify_lfs_videos())
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        // The build prerenders every page and checks homepage hydration in Chromium.
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(build())
        .add_step(install_infra_dependencies())
        .add_step(configure_aws_credentials())
        .add_step(pulumi_up())
        .add_step(steps::teardown_nix())
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("lfs", true))
}

/// Without LFS content the site would publish pointer files as its videos.
fn verify_lfs_videos() -> Step<Run> {
    Step::new("Verify Git LFS videos were downloaded")
        .run(indoc::indoc! {r#"
            if grep -RIl --include='*.mp4' 'version https://git-lfs.github.com/spec/v1' public src; then
              echo "Found Git LFS pointer files instead of real videos."
              exit 1
            fi
        "#})
        .working_directory(xtask_paths::repo_dir!("apps/marketing"))
}

fn build() -> Step<Run> {
    Step::new("Build")
        .run("bun run build")
        .working_directory(xtask_paths::repo_dir!("apps/marketing"))
        // Canonical URLs, sitemap and robots are baked in at build time.
        .add_env(Env::new(
            "VITE_APP_BASE_URL",
            "${{ matrix.environment == 'prod' && 'https://macro.com' || 'https://dev.macro.com' }}",
        ))
        .add_env(Env::new(
            "VITE_GOOGLE_SSO_URL",
            "${{ matrix.environment == 'prod' && 'https://gateway.macro.com/auth/login/sso?idp_name=google_gmail' || 'https://dev-gateway.macro.com/auth/login/sso?idp_name=google_gmail' }}",
        ))
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

/// The stack's own `invalidate-cache` command invalidates `/*` after the sync.
fn pulumi_up() -> Step<Use> {
    Step::new("Deploy with Pulumi")
        .uses(
            "pulumi",
            "actions",
            "8e5e406f4007fca908480587cb9893c07090f58d",
        ) // v6
        .add_with(("command", "up"))
        .add_with(("stack-name", format!("macro-inc/{ENVIRONMENT}")))
        .add_with(("work-dir", "./infra/stacks/website"))
        .add_env(Env::new("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
}
