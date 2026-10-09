//! `Build Web App` — builds apps/web for one environment and uploads `dist` as
//! the [`ARTIFACT`] run artifact. Call-only: [`crate::workflows::deploy_web_app`]
//! uses it for standalone deploys, and [`crate::workflows::deploy_on_push`]
//! calls it directly so the build overlaps the backend deploy and only the
//! upload waits for it. Generated into `build_web_app.yml`.

use anyhow::Result;
use gh_workflow::{Env, Event, Job, Run, Step, Use, Workflow, WorkflowCall};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Artifacts are scoped to the workflow run, and a called workflow shares its
/// caller's run, so the deploy job finds this regardless of which workflow
/// called the build.
pub const ARTIFACT: &str = "web-app-dist-${{ inputs.environment }}";

pub fn build_web_app() -> Workflow {
    Workflow::new("Build Web App")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("build", build_job())
}

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
                description: The environment to build for. e.g. (dev, prod)
            secrets:
              SEGMENT_WRITE_KEY:
                required: true
              POSTHOG_API_KEY:
                required: true
        "#})?,
    );
    Ok(())
}

/// The build uses the shared Namespace `web-ci` sccache cache, so no sccache
/// backend secret is needed here.
fn build_job() -> Job {
    Job::default()
        .name("Build")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_step(checkout())
        .add_step(steps::mount_web_build_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(build())
        .add_step(steps::show_sccache_stats())
        .add_step(upload_dist())
        .add_step(steps::teardown_nix())
}

/// The pushed commit, not the branch tip: a merge that lands while this run's
/// backend deploys must not ship its frontend against the older backend.
pub fn checkout() -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("ref", "${{ github.sha }}"))
}

/// Build identical across dev/prod up to `MODE` (`just build-<env>`).
fn build() -> Step<Run> {
    Step::new("Build")
        .run("just build-${{ inputs.environment }}")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("VITE_SEGMENT_WRITE_KEY", vars::SEGMENT_WRITE_KEY))
        .add_env(Env::new("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
        .add_env(Env::new(
            "VITE_OTEL_EXPORTER_URL",
            "${{ inputs.environment == 'prod' && 'https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces' || 'https://macro-prox-dev.macroverse.workers.dev/i/otlp/v1/traces' }}",
        ))
        .add_env(Env::new(
            "VITE_OTEL_ENV",
            "${{ inputs.environment == 'prod' && 'prod' || 'development' }}",
        ))
}

fn upload_dist() -> Step<Use> {
    Step::new("Upload dist")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .add_with(("name", ARTIFACT))
        .add_with(("path", xtask_paths::runtime_path!("apps/web/dist").as_str()))
        .add_with(("if-no-files-found", "error"))
        .add_with(("retention-days", 1))
        // A full re-run of the same run uploads again under the same name.
        .add_with(("overwrite", true))
}
