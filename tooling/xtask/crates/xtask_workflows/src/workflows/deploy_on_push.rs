//! `Deploy on Push` — the single push-to-main dev deploy pipeline. Mirrors the
//! production release flow (cloud storage first, then the sync service and web
//! app), except every stage is gated behind the `check-to-deploy` path diff so
//! only the stages whose inputs actually changed deploy — the release always
//! deploys everything. Replaces the separate `deploy_cloud_storage_on_push`
//! and `deploy_web_app_dev_push` workflows. Generated into `deploy_on_push.yml`
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
use gh_workflow::{Concurrency, Event, Expression, Job, Push, Step, Use, Workflow};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, web_artifact_paths};

/// Repository inputs that can change the deployed cloud-storage services —
/// the trigger paths of the replaced `deploy_cloud_storage_on_push` workflow,
/// expressed as a diff-checker group so the other stages can share one
/// push-to-main trigger.
const CLOUD_STORAGE_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("Cross.toml"),
    xtask_paths::repo_glob!("clippy.toml"),
    xtask_paths::repo_glob!("deny.toml"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!(".cargo/**"),
    xtask_paths::repo_glob!(".config/**"),
    xtask_paths::repo_glob!(".sqlx/**"),
    xtask_paths::repo_glob!("crates/**"),
    xtask_paths::repo_glob!("services/**"),
    xtask_paths::repo_glob!("tooling/xtask/**"),
    xtask_paths::repo_glob!("tooling/just/**"),
    xtask_paths::repo_glob!("tooling/scripts/**"),
    xtask_paths::repo_glob!("static_assets/**"),
    xtask_paths::repo_glob!("docker/**"),
    xtask_paths::repo_glob!("nix/**"),
    xtask_paths::repo_glob!("nix-support/**"),
    xtask_paths::repo_glob!("infra/**"),
    xtask_paths::repo_glob!(".github/workflows/deploy_on_push.yml"),
    xtask_paths::repo_glob!(".github/workflows/deploy_all_services.yml"),
    xtask_paths::repo_glob!(".github/actions/deploy-cloud-storage-pulumi/**"),
    xtask_paths::repo_glob!(".github/actions/setup-nix/**"),
    xtask_paths::repo_glob!(".github/actions/teardown-nix/**"),
    xtask_paths::repo_glob!(".github/actions/migrate-cloud-storage-db/**"),
    xtask_paths::repo_glob!(".github/scripts/build-cloud-storage-lambdas-nix.sh"),
    xtask_paths::repo_glob!(".github/services-config.json"),
    xtask_paths::repo_glob!(".github/workspace-dep-closures.json"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
];

/// Inputs that can change the deployed sync-service worker — the push trigger
/// paths the [`crate::workflows::deploy_sync_service`] workflow used before it
/// became call/dispatch-only.
const SYNC_SERVICE_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/sync-service/**"),
    xtask_paths::repo_glob!("crates/macro_sync_service_jwt/**"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!(".github/workflows/deploy_on_push.yml"),
    xtask_paths::repo_glob!(".github/workflows/deploy_sync_service.yml"),
];

/// Build the workflow. The caller jobs' `with:`/`secrets:` are filled in by
/// [`patch`].
pub fn deploy_on_push() -> Workflow {
    Workflow::new("Deploy on Push")
        .on(Event::default().push(Push::default().add_branch("main")))
        .concurrency(
            // Never cancel an in-progress deployment — that could leave a
            // stack half-applied. Queued pushes coalesce to the newest.
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job("check-to-deploy", check_to_deploy())
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

fn check_to_deploy() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            "cloud-storage",
            "${{ steps.changes.outputs.cloud-storage }}",
        )
        .add_output("sync-service", "${{ steps.changes.outputs.sync-service }}")
        .add_output("web-app", "${{ steps.changes.outputs.web-app }}")
        .add_step(checkout())
        .add_step(diff_checker())
}

fn deploy_cloud_storage() -> Job {
    Job::default()
        .name("Deploy Cloud Storage Services")
        .needs(vec!["check-to-deploy".to_string()])
        .cond(Expression::new(
            "${{ needs.check-to-deploy.outputs.cloud-storage == 'true' }}",
        ))
        .uses("./.github/workflows/deploy_all_services.yml")
}

/// The worker calls DSS/SPS, so don't ship it ahead of them (same ordering as
/// the production release) — but do ship it when the cloud-storage stage was
/// *skipped* for having no changes, hence `!failure()` instead of the implicit
/// `success()`.
fn deploy_sync_service() -> Job {
    Job::default()
        .name("Deploy Sync Service")
        .needs(vec![
            "check-to-deploy".to_string(),
            "deploy-cloud-storage".to_string(),
        ])
        .cond(Expression::new(
            "${{ !failure() && !cancelled() && needs.check-to-deploy.outputs.sync-service == 'true' }}",
        ))
        .uses("./.github/workflows/deploy_sync_service.yml")
}

/// Same skipped-backend tolerance as [`deploy_sync_service`].
fn deploy_web_app() -> Job {
    Job::default()
        .name("Deploy Web App")
        .needs(vec![
            "check-to-deploy".to_string(),
            "deploy-cloud-storage".to_string(),
        ])
        .cond(Expression::new(
            "${{ !failure() && !cancelled() && needs.check-to-deploy.outputs.web-app == 'true' }}",
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
    let diff = [
        diff_entry("cloud-storage", CLOUD_STORAGE_PATHS),
        diff_entry("sync-service", SYNC_SERVICE_PATHS),
        format!(
            "web-app: ./infra/stacks/web-app/** ./.github/workflows/deploy_on_push.yml ./.github/workflows/deploy_web_app.yml {}",
            web_artifact_paths::diff_checker_list()
        ),
    ]
    .join("\n");

    Step::new("Check changed paths")
        .uses(
            "whutchinson98",
            "diff-checker-action",
            "d25a22ee8f84f5e44abda3027c80c2e6d71f68a6",
        ) // v1.0.2
        .id("changes")
        .add_with(("token", "${{ github.token }}"))
        .add_with(("diff", diff))
}

/// Render one diff-checker group line (`<group>: ./a ./b/** …`).
fn diff_entry(group: &str, paths: &[RepoGlob<'static>]) -> String {
    let list = paths
        .iter()
        .map(|path| format!("./{}", path.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    format!("{group}: {list}")
}
