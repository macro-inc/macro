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

use gh_workflow::expr::typed::{Bool, Expr, Json, Str, format, from_json, input, matrix};
use gh_workflow::{
    Concurrency, Env, Event, Job, Push, Run, Step, Strategy, Use, Workflow, WorkflowCall,
    WorkflowCallSecret, WorkflowDispatch, WorkflowInput, ZizmorRule,
};

use crate::workflows::actions::{
    ActionsCheckout, AwsActionsConfigureAwsCredentials, PulumiActions,
};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// The environments to deploy, as a JSON list. On push `inputs.environment` is
/// empty, so push runs deploy `dev`; `both` deploys dev before prod.
fn environments() -> Expr<Json> {
    let requested = input::<Str>("environment");
    from_json(requested.clone().eq("both").then_else(
        r#"["dev","prod"]"#,
        format(r#"["{0}"]"#, [requested.or_else("dev").into_ast()]),
    ))
}

/// The environment of the current matrix leg.
fn environment() -> Expr<Str> {
    matrix("environment")
}

/// Build the workflow.
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
            .workflow_dispatch(
                WorkflowDispatch::default()
                    .add_input(
                        "environment",
                        WorkflowInput::choice(["dev", "prod", "both"])
                            .description(
                                "The environment to deploy to (both deploys dev, then prod)",
                            )
                            .required(true)
                            .default("dev"),
                    )
                    .add_input(
                        "preview_only",
                        WorkflowInput::boolean()
                            .description("Preview resource changes without publishing")
                            .default(false),
                    ),
            )
            .workflow_call(
                WorkflowCall::default()
                    .add_input(
                        "environment",
                        WorkflowInput::string()
                            .description("The environment to deploy to. e.g. (dev, prod, both)")
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
                    ),
            ))
        .add_job("build-deploy", build_deploy())
}

fn build_deploy() -> Job {
    Job::default()
        .name("Build and Deploy Website")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        // One leg at a time, in list order: with fail-fast, a failed dev deploy
        // cancels the queued prod leg.
        .strategy(Strategy {
            matrix: Some(
                serde_json::json!({ "environment": serde_json::Value::from(environments()) }),
            ),
            fail_fast: Some(true),
            max_parallel: Some(1),
        })
        // Per environment, so a `both` run still serializes with push and
        // release deploys of the same stack. Literal prefix rather than
        // `github.workflow`, which expands to the *caller's* name for
        // workflow_call runs. Never cancel in-progress — that could leave the
        // stack half-applied.
        .concurrency(
            Concurrency::new(format!("deploy-website-{}", environment())).cancel_in_progress(false),
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
    ActionsCheckout::new("Checkout Repo")
        .lfs(true)
        .step()
        .zizmor_ignore(
            ZizmorRule::Artipacked,
            "deploy scripts run from the checkout",
        )
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
        // The dev shell's Linux LD_LIBRARY_PATH makes Playwright's glibc-linked Chromium load Nix
        // libs built against a newer glibc. Drop BASH_ENV too: bun runs scripts via bash, which re-sources it.
        .run("env -u LD_LIBRARY_PATH -u BASH_ENV bun run build")
        .working_directory(xtask_paths::repo_dir!("apps/marketing"))
        // Canonical URLs, sitemap and robots are baked in at build time.
        .add_env(Env::new(
            "VITE_APP_BASE_URL",
            environment()
                .eq("prod")
                .then_else("https://macro.com", "https://dev.macro.com"),
        ))
        .add_env(Env::new(
            "VITE_GOOGLE_SSO_URL",
            environment().eq("prod").then_else(
                "https://gateway.macro.com/auth/login/sso?idp_name=google_gmail",
                "https://dev-gateway.macro.com/auth/login/sso?idp_name=google_gmail",
            ),
        ))
}

fn install_infra_dependencies() -> Step<Run> {
    Step::new("Install infra dependencies")
        .run("bun install")
        .working_directory(xtask_paths::repo_dir!("infra"))
}

fn configure_aws_credentials() -> Step<Use> {
    AwsActionsConfigureAwsCredentials::new("Configure AWS Credentials", "us-east-1")
        .aws_access_key_id(vars::AWS_ACCESS_KEY)
        .aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .step()
}

/// The stack's own `invalidate-cache` command invalidates `/*` after the sync.
fn pulumi_up() -> Step<Use> {
    PulumiActions::new("Deploy with Pulumi")
        .command(input::<Bool>("preview_only").then_else("preview", "up"))
        .stack_name(format!("macro-inc/{}", environment()))
        .work_dir("./infra/stacks/website")
        .step()
        .add_env(Env::new("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN))
}
