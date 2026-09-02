//! `Deploy on Push` — the single push-to-main dev deploy pipeline. Mirrors the
//! production release flow: cloud storage first, then the sync service and web
//! app, with every stage deploying unconditionally.
//!
//! Nothing is path-gated, deliberately. The pipeline serializes on one
//! concurrency group, and GitHub cancels a *pending* run as soon as a newer one
//! queues behind the same group — `cancel-in-progress: false` only protects the
//! run that is already executing. A gated pipeline therefore loses changes: a
//! backend-only push that gets superseded while queued is cancelled before its
//! deploy job starts, and the frontend-only push that replaced it skips the
//! backend stage, so that commit never ships. Deploying every stage from
//! whatever HEAD survives makes the coalescing safe — the surviving run is
//! always a superset of the ones it displaced.
//!
//! The called workflows already avoid redundant work internally (the service
//! matrix is Nix-cached and Pulumi no-ops unchanged stacks), so the cost of
//! dropping the gate is small next to a silently undeployed commit.
//!
//! Replaces the separate `deploy_cloud_storage_on_push` and
//! `deploy_web_app_dev_push` workflows. Generated into `deploy_on_push.yml`
//! (keep [`crate::workflows::cancel_stuck_cloud_storage_deploys`]'s
//! `WORKFLOW_FILE` in sync with this filename).
//!
//! NOTE: the top-level concurrency group deliberately differs from the called
//! workflows' literal groups (`deploy-all-services-dev`, `deploy-web-app-dev`,
//! `deploy-sync-service-dev`) — declaring the *same* group in a wrapper and
//! its called workflow makes GitHub detect a self-deadlock and cancel the run.
//! The called workflows' groups are still what serialize these push deploys
//! against manual dispatches of the individual pipelines.

use anyhow::Result;
use gh_workflow::{Concurrency, Event, Expression, Job, Push, Workflow};

/// Build the workflow. The caller jobs' `with:`/`secrets:` are filled in by
/// [`patch`].
pub fn deploy_on_push() -> Workflow {
    Workflow::new("Deploy on Push")
        .on(Event::default().push(Push::default().add_branch("main")))
        .concurrency(
            // Never cancel an in-progress deployment — that could leave a
            // stack half-applied. Queued pushes coalesce to the newest, which
            // is only lossless because no stage is path-gated (see module docs).
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job("deploy-cloud-storage", deploy_cloud_storage())
        .add_job("deploy-sync-service", deploy_sync_service())
        .add_job("deploy-web-app", deploy_web_app())
}

/// Add the caller jobs' `with:` and explicit `secrets:` maps, and drop the
/// `runs-on` that `Job::default()` injects (invalid alongside `uses:`).
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let cloud_storage = crate::workflows::job_mut(root, "deploy-cloud-storage")?;
    cloud_storage.remove("runs-on");
    cloud_storage.insert(
        "with".into(),
        crate::workflows::yaml_fragment("environment: dev")?,
    );
    cloud_storage.insert(
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

    let sync_service = crate::workflows::job_mut(root, "deploy-sync-service")?;
    sync_service.remove("runs-on");
    sync_service.insert(
        "with".into(),
        crate::workflows::yaml_fragment("environment: dev")?,
    );
    sync_service.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        "#})?,
    );

    let web_app = crate::workflows::job_mut(root, "deploy-web-app")?;
    web_app.remove("runs-on");
    web_app.insert(
        "with".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            notify: false
            environment: dev
        "#})?,
    );
    web_app.insert(
        "secrets".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
            AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
            PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
            DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
            DD_API_KEY: ${{ secrets.DD_API_KEY }}
            SEGMENT_WRITE_KEY: ${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}
            POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
        "#})?,
    );
    Ok(())
}

fn deploy_cloud_storage() -> Job {
    Job::default()
        .name("Deploy Cloud Storage Services")
        .uses("./.github/workflows/deploy_all_services.yml")
}

/// The worker calls DSS/SPS, so don't ship it ahead of them — same ordering as
/// the production release. The implicit `success()` on `needs` is what holds it
/// back when the backend deploy fails.
fn deploy_sync_service() -> Job {
    Job::default()
        .name("Deploy Sync Service")
        .needs(vec!["deploy-cloud-storage".to_string()])
        .uses("./.github/workflows/deploy_sync_service.yml")
}

/// Same ordering rationale as [`deploy_sync_service`].
fn deploy_web_app() -> Job {
    Job::default()
        .name("Deploy Web App")
        .needs(vec!["deploy-cloud-storage".to_string()])
        .uses("./.github/workflows/deploy_web_app.yml")
}
