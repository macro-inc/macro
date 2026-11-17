//! `Deploy Production Release` — ships a published GitHub release to prod. The
//! same order as [`crate::workflows::deploy_on_push`] for dev: cloud storage,
//! then the sync service and the Cloudflare workers, then the web app, whose
//! build overlaps the backend deploy. The website deploys alongside, and the
//! held iOS App Store version is released once the web app is live. Generated
//! into `release-production.yml`, the name it had when it was hand-written,
//! which is its identity in GitHub Actions.

use gh_workflow::expr::typed::{Bool, Expr, JobHandle, github};
use gh_workflow::{
    CallJob, Concurrency, Event, Job, Level, Permissions, Release, ReleaseType, Run, Step, Use,
    Workflow,
};

use crate::workflows::{build_web_app, deploy_web_app, runners, steps, vars};

#[cfg(test)]
mod test;

pub(crate) const DEPLOY_CLOUD_STORAGE: JobHandle<()> = JobHandle::new("deploy-cloud-storage", ());
pub(crate) const DEPLOY_SYNC_SERVICE: JobHandle<()> = JobHandle::new("deploy-sync-service", ());
/// Builds the web app.
pub(crate) const BUILD: JobHandle<()> = JobHandle::new("build", ());
/// Deploys the web app.
pub(crate) const DEPLOY: JobHandle<()> = JobHandle::new("deploy", ());

/// What the release deploys to.
const ENVIRONMENT: &str = "prod";

/// Only a release triggers this workflow; the jobs that start it keep the
/// guard the hand-written workflow had.
fn on_release() -> Expr<Bool> {
    github().event_name().eq("release")
}

pub fn release_production() -> Workflow {
    Workflow::new("Deploy Production Release")
        .on(Event::default().release(Release::default().add_type(ReleaseType::Released)))
        .concurrency(
            // Never cancel an in-progress deployment: that could leave a stack
            // half-applied.
            Concurrency::new(format!("{}-production", github().workflow()))
                .cancel_in_progress(false),
        )
        .add_env(("MODE", "production"))
        .add_job(DEPLOY_CLOUD_STORAGE, deploy_cloud_storage())
        .add_job(DEPLOY_SYNC_SERVICE, deploy_sync_service())
        .add_job("deploy-ai-editing-worker", deploy_ai_editing_worker())
        .add_job("deploy-mcp-chatgpt-worker", deploy_mcp_chatgpt_worker())
        .add_job("deploy-website", deploy_website())
        .add_job("publish-ios", publish_ios())
        .add_job(BUILD, build())
        .add_job(DEPLOY, deploy())
        .add_job("upload", upload())
}

fn deploy_cloud_storage() -> CallJob {
    CallJob::new("./.github/workflows/deploy_all_services.yml")
        .name("Deploy Cloud Storage Services")
        .cond(on_release())
        .add_with("environment", ENVIRONMENT)
        .add_secret("AWS_ACCESS_KEY", vars::AWS_ACCESS_KEY)
        .add_secret("AWS_SECRET_ACCESS_KEY", vars::AWS_SECRET_ACCESS_KEY)
        .add_secret("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN)
        .add_secret("DD_APP_KEY", vars::DD_APP_KEY)
        .add_secret("DD_API_KEY", vars::DD_API_KEY)
        .add_secret("NIX_CACHE_SIGNING_KEY", vars::NIX_CACHE_SIGNING_KEY)
}

/// The worker calls DSS/SPS at prod URLs, so don't ship it ahead of them.
fn deploy_sync_service() -> CallJob {
    CallJob::new("./.github/workflows/deploy_sync_service.yml")
        .name("Deploy Sync Service")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
        .add_with("environment", ENVIRONMENT)
        .inherit_secrets()
}

/// Calls DSS/search/auth at prod URLs and opens doc sessions against the prod
/// sync-service, so it ships behind both. It must also move in lockstep with
/// cloud-storage's EditDocument tool, which picks the worker's model chains.
fn deploy_ai_editing_worker() -> CallJob {
    CallJob::new("./.github/workflows/deploy_ai_editing_worker.yml")
        .name("Deploy AI Editing Worker")
        .needs(vec![
            DEPLOY_CLOUD_STORAGE.to_string(),
            DEPLOY_SYNC_SERVICE.to_string(),
        ])
        .add_with("environment", ENVIRONMENT)
        .inherit_secrets()
}

/// Calls the backend at prod URLs through the SDK and takes its tokens from
/// the MCP auth broker, so it ships behind cloud storage. Nothing waits on it.
fn deploy_mcp_chatgpt_worker() -> CallJob {
    CallJob::new("./.github/workflows/deploy_mcp_chatgpt_worker.yml")
        .name("Deploy MCP ChatGPT Worker")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
        .add_with("environment", ENVIRONMENT)
        .inherit_secrets()
}

/// Also owns the macro.com CloudFront distribution in front of the web app.
fn deploy_website() -> CallJob {
    CallJob::new("./.github/workflows/deploy_website.yml")
        .name("Deploy Website")
        .cond(on_release())
        .add_with("environment", ENVIRONMENT)
        .add_secret("AWS_ACCESS_KEY", vars::AWS_ACCESS_KEY)
        .add_secret("AWS_SECRET_ACCESS_KEY", vars::AWS_SECRET_ACCESS_KEY)
        .add_secret("PULUMI_ACCESS_TOKEN", vars::PULUMI_ACCESS_TOKEN)
}

/// Releases the iOS version Apple approved for the native changes in this
/// release; it is held until now. It waits for the web deploy, so the native
/// build never goes live while prod still serves the previous web bundle (a
/// release request cannot be cancelled). Nothing depends on it: an App Store
/// Connect failure must not hold back the prod deploy.
fn publish_ios() -> CallJob {
    CallJob::new("./.github/workflows/ios-app-store-publish.yml")
        .name("Publish iOS App Store Version")
        .needs(vec![DEPLOY.to_string()])
        .permissions(Permissions::default().contents(Level::Read))
        .add_secret("IOS_RELEASE_DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN)
}

/// The same build as dev deploys and manual web deploys. It reuses unchanged
/// wasm packages from main's Actions cache, which those deploy builds fill.
/// Like them, it mounts only the Nix store and Bun's package cache from the
/// cache volume, as the release's own build job did, and uses no shared
/// sccache. No `needs`, so it overlaps the backend deploy.
fn build() -> CallJob {
    CallJob::new("./.github/workflows/build_web_app.yml")
        .name("Build Web App")
        .cond(on_release())
        .add_with("environment", ENVIRONMENT)
        .add_secret("SEGMENT_WRITE_KEY", vars::SEGMENT_WRITE_KEY_PRODUCTION)
        .add_secret("POSTHOG_API_KEY", vars::POSTHOG_API_KEY)
}

/// New clients require the worker's sync protocol support before publication,
/// so a failed sync deploy holds the web app back.
fn deploy() -> Job {
    Job::default()
        .name("Deploy Web App")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .needs(vec![
            BUILD.to_string(),
            DEPLOY_CLOUD_STORAGE.to_string(),
            DEPLOY_SYNC_SERVICE.to_string(),
        ])
        .add_env(("CI", "true"))
        .add_step(build_web_app::checkout())
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(deploy_web_app::download_dist(&build_web_app::artifact(
            ENVIRONMENT,
        )))
        .add_step(deploy_web_app::install_infra_dependencies())
        .add_step(deploy_web_app::configure_aws_credentials())
        .add_step(deploy_web_app::pulumi_up(ENVIRONMENT))
        .add_step(deploy_web_app::upload_sourcemaps(ENVIRONMENT))
        .add_step(steps::teardown_nix())
}

/// Attaches the deployed bundle to the release; it builds nothing.
fn upload() -> Job {
    Job::default()
        .name("Upload Release Artifacts")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .needs(vec![BUILD.to_string(), DEPLOY.to_string()])
        .add_step(build_web_app::checkout())
        .add_step(deploy_web_app::download_dist(&build_web_app::artifact(
            ENVIRONMENT,
        )))
        .add_step(archive_dist())
        .add_step(attach_to_release())
}

fn release_archive() -> String {
    format!("web-app-{}.tar.gz", github().ref_name())
}

fn archive_dist() -> Step<Run> {
    Step::new("Create Web App Artifact").run(format!(
        "tar -czf {} -C {} .",
        release_archive(),
        xtask_paths::runtime_path!("apps/web/dist").as_str()
    ))
}

fn attach_to_release() -> Step<Use> {
    Step::new("Upload Release Artifacts")
        .uses(
            "softprops",
            "action-gh-release",
            "3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
        ) // v2
        .add_with(("files", release_archive()))
}
