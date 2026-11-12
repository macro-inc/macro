//! `Deploy Production Release` — ships a published GitHub release to prod. The
//! same order as [`crate::workflows::deploy_on_push`] for dev: cloud storage,
//! then the sync service and the AI editing worker, then the web app, whose
//! build overlaps the backend deploy. The website deploys alongside, and the
//! held iOS App Store version is released once the web app is live. Generated
//! into `release-production.yml`, the name it had when it was hand-written,
//! which is its identity in GitHub Actions.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Release, ReleaseType, Run, Step, Use,
    Workflow,
};

use crate::workflows::{build_web_app, deploy_web_app, runners, steps, vars};

#[cfg(test)]
mod test;

/// What the release deploys to.
const ENVIRONMENT: &str = "prod";

/// Only a release triggers this workflow; the jobs that start it keep the
/// guard the hand-written workflow had.
const ON_RELEASE: &str = "github.event_name == 'release'";

pub fn release_production() -> Workflow {
    Workflow::new("Deploy Production Release")
        .on(Event::default().release(Release::default().add_type(ReleaseType::Released)))
        .concurrency(
            // Never cancel an in-progress deployment: that could leave a stack
            // half-applied.
            Concurrency::new(Expression::new("${{ github.workflow }}-production"))
                .cancel_in_progress(false),
        )
        .add_env(("MODE", "production"))
        .add_job("deploy-cloud-storage", deploy_cloud_storage())
        .add_job("deploy-sync-service", deploy_sync_service())
        .add_job("deploy-ai-editing-worker", deploy_ai_editing_worker())
        .add_job("deploy-website", deploy_website())
        .add_job("publish-ios", publish_ios())
        .add_job("build", build())
        .add_job("deploy", deploy())
        .add_job("upload", upload())
}

/// Add the caller jobs' `with:` and `secrets:`, and drop the `runs-on` that
/// `Job::default()` injects (invalid alongside `uses:`).
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let callers = [
        (
            "deploy-cloud-storage",
            true,
            indoc::indoc! {r#"
                AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
                AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
                PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
                DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
                DD_API_KEY: ${{ secrets.DD_API_KEY }}
                NIX_CACHE_SIGNING_KEY: ${{ secrets.NIX_CACHE_SIGNING_KEY }}
            "#},
        ),
        ("deploy-sync-service", true, "inherit"),
        ("deploy-ai-editing-worker", true, "inherit"),
        (
            "deploy-website",
            true,
            indoc::indoc! {r#"
                AWS_ACCESS_KEY: ${{ secrets.AWS_ACCESS_KEY }}
                AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
                PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
            "#},
        ),
        (
            "publish-ios",
            false,
            "IOS_RELEASE_DOPPLER_TOKEN: ${{ secrets.IOS_RELEASE_DOPPLER_TOKEN }}",
        ),
        (
            "build",
            true,
            indoc::indoc! {r#"
                SEGMENT_WRITE_KEY: ${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}
                POSTHOG_API_KEY: ${{ secrets.POSTHOG_API_KEY }}
            "#},
        ),
    ];
    for (id, takes_environment, secrets) in callers {
        let job = crate::workflows::job_mut(root, id)?;
        job.remove("runs-on");
        if takes_environment {
            job.insert(
                "with".into(),
                crate::workflows::yaml_fragment(&format!("environment: {ENVIRONMENT}"))?,
            );
        }
        job.insert("secrets".into(), crate::workflows::yaml_fragment(secrets)?);
    }
    Ok(())
}

fn deploy_cloud_storage() -> Job {
    Job::default()
        .name("Deploy Cloud Storage Services")
        .cond(Expression::new(ON_RELEASE))
        .uses("./.github/workflows/deploy_all_services.yml")
}

/// The worker calls DSS/SPS at prod URLs, so don't ship it ahead of them.
fn deploy_sync_service() -> Job {
    Job::default()
        .name("Deploy Sync Service")
        .needs(vec!["deploy-cloud-storage".to_string()])
        .uses("./.github/workflows/deploy_sync_service.yml")
}

/// Calls DSS/search/auth at prod URLs and opens doc sessions against the prod
/// sync-service, so it ships behind both. It must also move in lockstep with
/// cloud-storage's EditDocument tool, which picks the worker's model chains.
fn deploy_ai_editing_worker() -> Job {
    Job::default()
        .name("Deploy AI Editing Worker")
        .needs(vec![
            "deploy-cloud-storage".to_string(),
            "deploy-sync-service".to_string(),
        ])
        .uses("./.github/workflows/deploy_ai_editing_worker.yml")
}

/// Also owns the macro.com CloudFront distribution in front of the web app.
fn deploy_website() -> Job {
    Job::default()
        .name("Deploy Website")
        .cond(Expression::new(ON_RELEASE))
        .uses("./.github/workflows/deploy_website.yml")
}

/// Releases the iOS version Apple approved for the native changes in this
/// release; it is held until now. It waits for the web deploy, so the native
/// build never goes live while prod still serves the previous web bundle (a
/// release request cannot be cancelled). Nothing depends on it: an App Store
/// Connect failure must not hold back the prod deploy.
fn publish_ios() -> Job {
    Job::default()
        .name("Publish iOS App Store Version")
        .needs(vec!["deploy".to_string()])
        .permissions(Permissions::default().contents(Level::Read))
        .uses("./.github/workflows/ios-app-store-publish.yml")
}

/// The same build as dev deploys and manual web deploys. It reuses unchanged
/// wasm packages from main's Actions cache, which those deploy builds fill, and
/// like them reads nothing pull requests write beyond the Nix and Bun caches
/// the release's own build job always read. No `needs`, so it overlaps the
/// backend deploy.
fn build() -> Job {
    Job::default()
        .name("Build Web App")
        .cond(Expression::new(ON_RELEASE))
        .uses("./.github/workflows/build_web_app.yml")
}

/// New clients require the worker's sync protocol support before publication,
/// so a failed sync deploy holds the web app back.
fn deploy() -> Job {
    Job::default()
        .name("Deploy Web App")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .needs(vec![
            "build".to_string(),
            "deploy-cloud-storage".to_string(),
            "deploy-sync-service".to_string(),
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
        .needs(vec!["build".to_string(), "deploy".to_string()])
        .add_step(build_web_app::checkout())
        .add_step(deploy_web_app::download_dist(&build_web_app::artifact(
            ENVIRONMENT,
        )))
        .add_step(archive_dist())
        .add_step(attach_to_release())
}

const RELEASE_ARCHIVE: &str = "web-app-${{ github.ref_name }}.tar.gz";

fn archive_dist() -> Step<Run> {
    Step::new("Create Web App Artifact").run(format!(
        "tar -czf {RELEASE_ARCHIVE} -C {} .",
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
        .add_with(("files", RELEASE_ARCHIVE))
}
