//! `Deploy on Push` — the single push-to-main dev deploy pipeline. Mirrors the
//! production release flow: cloud storage first, then the sync service and the
//! ChatGPT MCP worker, then the web app, with every stage deploying
//! unconditionally. The web app *builds* in parallel with the backend; only its
//! upload waits, so the frontend still goes live last.
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
//! matrix is Nix-cached, Pulumi no-ops unchanged stacks, and the sync worker
//! compares its inputs with the live version), so the cost of dropping the gate
//! is small next to a silently undeployed commit. Those checks are safe because
//! they compare with what is deployed, not with the previous push.
//!
//! Replaces the separate `deploy_cloud_storage_on_push` and
//! `deploy_web_app_dev_push` workflows. Generated into `deploy_on_push.yml`
//! (keep [`crate::workflows::cancel_stuck_cloud_storage_deploys`]'s
//! `WORKFLOW_FILE` in sync with this filename).
//!
//! NOTE: the top-level concurrency group deliberately differs from the called
//! workflows' literal groups (`deploy-all-services-dev`, `deploy-web-app-dev`,
//! `deploy-sync-service-dev`, `deploy-mcp-chatgpt-worker-dev`) — declaring the
//! *same* group in a wrapper and its called workflow makes GitHub detect a
//! self-deadlock and cancel the run.
//! The called workflows' groups are still what serialize these push deploys
//! against manual dispatches of the individual pipelines.

use gh_workflow::expr::typed::{JobHandle, github};
use gh_workflow::{CallJob, Concurrency, Event, Push, Workflow};

use crate::workflows::actions::{
    CallBuildWebApp, CallDeployAllServices, CallDeployMcpChatgptWorker, CallDeploySyncService,
    CallDeployWebApp,
};
use crate::workflows::vars;

#[cfg(test)]
mod test;

pub(crate) const DEPLOY_CLOUD_STORAGE: JobHandle<()> = JobHandle::new("deploy-cloud-storage", ());
pub(crate) const DEPLOY_SYNC_SERVICE: JobHandle<()> = JobHandle::new("deploy-sync-service", ());
pub(crate) const BUILD_WEB_APP: JobHandle<()> = JobHandle::new("build-web-app", ());

/// Prepended to the generated YAML, under the "do not edit" header. The
/// no-gating decision is the single most likely thing for someone to try to
/// "optimize" while reading the workflow file rather than this module, so the
/// reasoning has to live in the generated output too.
pub const NOTICE: &str = indoc::indoc! {"
    #
    # Every stage here deploys on every push — deliberately NOT path-gated.
    # Do not add `if:` change filters to these jobs.
    #
    # This pipeline serializes on one concurrency group, and GitHub keeps only
    # ONE pending run per group: a newly queued run cancels the run already
    # waiting. `cancel-in-progress: false` does not prevent that — it only
    # protects the run that is actively executing.
    #
    # So with change filters, pushes get silently dropped. Push A (backend) is
    # queued behind a running deploy; push B (frontend-only) arrives and
    # cancels A before its deploy job ever starts; B runs and its filter skips
    # the backend stage. A's commit is on main and was never deployed.
    #
    # Deploying everything unconditionally makes the coalescing lossless: the
    # surviving run always deploys a superset of the runs it displaced. The
    # called workflows already avoid redundant work internally (Nix-cached
    # builds, Pulumi no-ops on unchanged stacks, the sync worker comparing its
    # inputs with the live version), so the cost is small next to an undeployed
    # commit. Those checks compare with what is deployed, never the last push.
    #
"};

/// Build the workflow.
pub fn deploy_on_push() -> Workflow {
    Workflow::new("Deploy on Push")
        .on(Event::default().push(Push::default().add_branch("main")))
        .concurrency(
            // Never cancel an in-progress deployment — that could leave a
            // stack half-applied. Queued pushes coalesce to the newest, which
            // is only lossless because no stage is path-gated (see module docs).
            Concurrency::new(github().workflow().to_string()).cancel_in_progress(false),
        )
        .add_job(DEPLOY_CLOUD_STORAGE, deploy_cloud_storage())
        .add_job(DEPLOY_SYNC_SERVICE, deploy_sync_service())
        .add_job("deploy-mcp-chatgpt-worker", deploy_mcp_chatgpt_worker())
        .add_job(BUILD_WEB_APP, build_web_app())
        .add_job("deploy-web-app", deploy_web_app())
}

fn deploy_cloud_storage() -> CallJob {
    CallDeployAllServices::new("dev")
        .secret_aws_access_key(vars::AWS_ACCESS_KEY)
        .secret_aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .secret_pulumi_access_token(vars::PULUMI_ACCESS_TOKEN)
        .secret_dd_app_key(vars::DD_APP_KEY)
        .secret_dd_api_key(vars::DD_API_KEY)
        .secret_nix_cache_signing_key(vars::NIX_CACHE_SIGNING_KEY)
        .job()
        .name("Deploy Cloud Storage Services")
}

/// The worker calls DSS/SPS, so don't ship it ahead of them — same ordering as
/// the production release. The implicit `success()` on `needs` is what holds it
/// back when the backend deploy fails.
fn deploy_sync_service() -> CallJob {
    CallDeploySyncService::new("dev")
        .secret_cloudflare_api_token(vars::CLOUDFLARE_API_TOKEN)
        .job()
        .name("Deploy Sync Service")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
}

/// The ChatGPT MCP server calls the backend through the SDK and takes its tokens
/// from the MCP auth broker, so it ships behind them, like the sync worker.
/// Nothing waits on it: the web app doesn't talk to it.
fn deploy_mcp_chatgpt_worker() -> CallJob {
    CallDeployMcpChatgptWorker::new("dev")
        .secret_cloudflare_api_token(vars::CLOUDFLARE_API_TOKEN)
        .job()
        .name("Deploy MCP ChatGPT Worker")
        .needs(vec![DEPLOY_CLOUD_STORAGE.to_string()])
}

/// No `needs`: the build only reads the commit, so it overlaps the backend's
/// ~15 minutes instead of adding ~4 after them.
fn build_web_app() -> CallJob {
    CallBuildWebApp::new("dev")
        .secret_segment_write_key(vars::SEGMENT_WRITE_KEY_PRODUCTION)
        .secret_posthog_api_key(vars::POSTHOG_API_KEY)
        .job()
        .name("Build Web App")
}

/// Publish only after the worker supports the frontend's sync protocol. The
/// build remains parallel, but a failed worker deploy must block new clients.
fn deploy_web_app() -> CallJob {
    CallDeployWebApp::new("dev")
        .notify(false)
        .prebuilt(true)
        .secret_aws_access_key(vars::AWS_ACCESS_KEY)
        .secret_aws_secret_access_key(vars::AWS_SECRET_ACCESS_KEY)
        .secret_pulumi_access_token(vars::PULUMI_ACCESS_TOKEN)
        .secret_dd_app_key(vars::DD_APP_KEY)
        .secret_dd_api_key(vars::DD_API_KEY)
        .secret_segment_write_key(vars::SEGMENT_WRITE_KEY_PRODUCTION)
        .secret_posthog_api_key(vars::POSTHOG_API_KEY)
        .job()
        .name("Deploy Web App")
        .needs(vec![
            DEPLOY_CLOUD_STORAGE.to_string(),
            DEPLOY_SYNC_SERVICE.to_string(),
            BUILD_WEB_APP.to_string(),
        ])
}
