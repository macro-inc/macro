//! `Deploy web app dev on push to main` — path-gated caller of
//! [`crate::workflows::deploy_web_app`]. Generated into
//! `deploy_web_app_dev_push.yml` (replaces the hand-written
//! `deploy-web-app-dev-push.yml`).

use anyhow::Result;
use gh_workflow::{Concurrency, Event, Expression, Job, Push, Step, Use, Workflow};

use crate::workflows::{runners, web_artifact_paths};

/// Build the workflow. The caller job's `with:`/`secrets:` are filled in by
/// [`patch`].
pub fn deploy_web_app_dev_push() -> Workflow {
    Workflow::new("Deploy web app dev on push to main")
        .on(Event::default().push(Push::default().add_branch("main")))
        .concurrency(
            // Never cancel an in-progress deployment — that could leave the
            // stack half-applied.
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job("check-to-deploy", check_to_deploy())
        .add_job("deploy_web_app", deploy_web_app())
}

/// Add the caller job's `with:` and explicit `secrets:` map, and drop the
/// `runs-on` that `Job::default()` injects (invalid alongside `uses:`).
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let job = crate::workflows::job_mut(root, "deploy_web_app")?;
    job.remove("runs-on");
    job.insert(
        "with".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            notify: false
            environment: dev
        "#})?,
    );
    job.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
            AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
            DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
            DD_API_KEY: ${{ secrets.DD_API_KEY }}
            DD_WEB_APP_TOKEN: ${{ secrets.DD_WEB_APP_TOKEN }}
            SEGMENT_WRITE_KEY: ${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}
            POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
        "#})?,
    );
    Ok(())
}

fn check_to_deploy() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("web-app", "${{ steps.changes.outputs.web-app }}")
        .add_step(checkout())
        .add_step(diff_checker())
}

fn deploy_web_app() -> Job {
    Job::default()
        .needs(vec!["check-to-deploy".to_string()])
        .cond(Expression::new(
            "${{ needs.check-to-deploy.outputs.web-app == 'true' }}",
        ))
        .uses("./.github/workflows/deploy_web_app.yml")
}

fn checkout() -> Step<Use> {
    Step::new("Checkout Repo").uses(
        "actions",
        "checkout",
        "df4cb1c069e1874edd31b4311f1884172cec0e10",
    ) // v6
}

fn diff_checker() -> Step<Use> {
    let web_app_paths = web_artifact_paths::diff_checker_list();

    Step::new("Check changed paths")
        .uses(
            "whutchinson98",
            "diff-checker-action",
            "d25a22ee8f84f5e44abda3027c80c2e6d71f68a6",
        ) // v1.0.2
        .id("changes")
        .add_with(("token", "${{ github.token }}"))
        .add_with((
            "diff",
            format!("web-app: ./infra/stacks/web-app/** {web_app_paths}"),
        ))
}
