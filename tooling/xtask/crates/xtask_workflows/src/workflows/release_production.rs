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
    Workflow, ZizmorRule,
};

use crate::workflows::actions::{
    CallBuildWebApp, CallDeployAiEditingWorker, CallDeployAllServices, CallDeployMcpChatgptWorker,
    CallDeploySyncService, CallDeployWebsite, CallIosAppStorePublish, SoftpropsActionGhRelease,
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
    CallDeployAllServices::new(ENVIRONMENT)
        .secret_aws_access_key(vars::AWS_ACCESS_KEY)
        .secret_aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .secret_pulumi_access_token(vars::PULUMI_ACCESS_TOKEN)
        .secret_dd_app_key(vars::DD_APP_KEY)
        .secret_dd_api_key(vars::DD_API_KEY)
        .secret_nix_cache_signing_key(vars::NIX_CACHE_SIGNING_KEY)
        .job()
        .name("Deploy Cloud Storage Services")
        .cond(on_release())
}

/// The worker calls DSS/SPS at prod URLs, so don't ship it ahead of them.
fn deploy_sync_service() -> CallJob {
    CallDeploySyncService::new(ENVIRONMENT)
        .inherit_secrets()
        .job()
        .name("Deploy Sync Service")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
}

/// Calls DSS/search/auth at prod URLs and opens doc sessions against the prod
/// sync-service, so it ships behind both. It must also move in lockstep with
/// cloud-storage's EditDocument tool, which picks the worker's model chains.
fn deploy_ai_editing_worker() -> CallJob {
    CallDeployAiEditingWorker::new(ENVIRONMENT)
        .inherit_secrets()
        .job()
        .name("Deploy AI Editing Worker")
        .needs(vec![
            DEPLOY_CLOUD_STORAGE.to_string(),
            DEPLOY_SYNC_SERVICE.to_string(),
        ])
}

/// Calls the backend at prod URLs through the SDK and takes its tokens from
/// the MCP auth broker, so it ships behind cloud storage. Nothing waits on it.
fn deploy_mcp_chatgpt_worker() -> CallJob {
    CallDeployMcpChatgptWorker::new(ENVIRONMENT)
        .inherit_secrets()
        .job()
        .name("Deploy MCP ChatGPT Worker")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
}

/// Also owns the macro.com CloudFront distribution in front of the web app.
fn deploy_website() -> CallJob {
    CallDeployWebsite::new(ENVIRONMENT)
        .secret_aws_access_key(vars::AWS_ACCESS_KEY)
        .secret_aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .secret_pulumi_access_token(vars::PULUMI_ACCESS_TOKEN)
        .job()
        .name("Deploy Website")
        .cond(on_release())
}

/// Releases the iOS version Apple approved for the native changes in this
/// release; it is held until now. It waits for the web deploy, so the native
/// build never goes live while prod still serves the previous web bundle (a
/// release request cannot be cancelled). Nothing depends on it: an App Store
/// Connect failure must not hold back the prod deploy.
fn publish_ios() -> CallJob {
    CallIosAppStorePublish::new()
        .secret_ios_release_doppler_token(vars::IOS_RELEASE_DOPPLER_TOKEN)
        .job()
        .name("Publish iOS App Store Version")
        .needs(vec![DEPLOY.to_string()])
        .permissions(Permissions::default().contents(Level::Read))
}

/// The same build as dev deploys and manual web deploys. It reuses unchanged
/// wasm packages from main's Actions cache, which those deploy builds fill.
/// Like them, it mounts only the Nix store and Bun's package cache from the
/// cache volume, as the release's own build job did, and uses no shared
/// sccache. No `needs`, so it overlaps the backend deploy.
fn build() -> CallJob {
    CallBuildWebApp::new(ENVIRONMENT)
        .secret_segment_write_key(vars::SEGMENT_WRITE_KEY_PRODUCTION)
        .secret_posthog_api_key(vars::POSTHOG_API_KEY)
        .job()
        .name("Build Web App")
        .cond(on_release())
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
        .add_step(build_web_app::checkout().zizmor_ignore(
            ZizmorRule::Artipacked,
            "release scripts run from the checkout",
        ))
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
        .add_step(build_web_app::checkout().zizmor_ignore(
            ZizmorRule::Artipacked,
            "release scripts run from the checkout",
        ))
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
    Step::new("Create Web App Artifact")
        .run(format!(
            "tar -czf \"web-app-${{REF_NAME}}.tar.gz\" -C {} .",
            xtask_paths::runtime_path!("apps/web/dist").as_str()
        ))
        .add_env(("REF_NAME", github().ref_name()))
}

fn attach_to_release() -> Step<Use> {
    SoftpropsActionGhRelease::new("Upload Release Artifacts")
        .files(release_archive())
        .step()
}
