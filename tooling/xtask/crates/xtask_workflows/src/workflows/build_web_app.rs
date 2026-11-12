//! `Build Web App` — builds apps/web for one environment and uploads `dist` as
//! the [`ARTIFACT`] run artifact. Call-only: [`crate::workflows::deploy_web_app`]
//! uses it for standalone deploys, and [`crate::workflows::deploy_on_push`]
//! calls it directly so the build overlaps the backend deploy and only the
//! upload waits for it. Generated into `build_web_app.yml`.

use anyhow::Result;
use gh_workflow::{Env, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall};

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
///
/// Wasm packages whose inputs did not change come from a GitHub Actions cache
/// instead of being rebuilt with LTO. A run on a branch only reads its own
/// scope and the default branch's, so a pull request cannot write what a deploy
/// reads; the Namespace HTTP cache PR jobs share stays off here.
fn build_job() -> Job {
    Job::default()
        .name("Build")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_env(("WASM_PKG_CACHE_DIR", vars::DEPLOY_WASM_PKG_CACHE_DIR))
        .add_step(checkout())
        .add_step(steps::mount_web_build_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(restore_wasm_packages())
        .add_step(build_wasm_packages())
        .add_step(save_wasm_packages())
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

/// Saved entries are named by the set of package keys they hold plus the run
/// that saved them (`scripts/deploy_build_wasm.sh`), and the newest one in
/// scope is restored. A run name keeps a set that comes back, say after a
/// revert, saveable again: Actions cache entries cannot be overwritten.
const WASM_PACKAGES_KEY_PREFIX: &str = "deploy-wasm-pkgs-v1-";

/// actions/cache v5.0.5.
const ACTIONS_CACHE_SHA: &str = "27d5ce7f107fe9357f9df03efb73ab90386fccae";

/// The packages are tens of megabytes. A transfer that stalls gives up and the
/// build goes on without them rather than holding the deploy.
const WASM_CACHE_TIMEOUT_MINUTES: u32 = 3;

fn restore_wasm_packages() -> Step<Use> {
    Step::new("Restore wasm packages")
        .uses("actions/cache", "restore", ACTIONS_CACHE_SHA)
        .id("restore-wasm")
        .continue_on_error(true)
        .timeout_minutes(WASM_CACHE_TIMEOUT_MINUTES)
        .add_with(("path", vars::DEPLOY_WASM_PKG_CACHE_DIR))
        .add_with((
            "key",
            format!("{WASM_PACKAGES_KEY_PREFIX}${{{{ github.sha }}}}"),
        ))
        .add_with(("restore-keys", WASM_PACKAGES_KEY_PREFIX))
}

/// Its own step, saved before the app build, so a run whose app build fails
/// still keeps its packages. It names the set to save, or nothing when the
/// restored entry already holds it.
fn build_wasm_packages() -> Step<Run> {
    Step::new("Build wasm packages")
        .run(include_str!("scripts/deploy_build_wasm.sh"))
        .id("wasm")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("KEY_PREFIX", WASM_PACKAGES_KEY_PREFIX))
        .add_env((
            "RESTORED_KEY",
            "${{ steps.restore-wasm.outputs.cache-matched-key }}",
        ))
}

fn save_wasm_packages() -> Step<Use> {
    Step::new("Save wasm packages")
        .uses("actions/cache", "save", ACTIONS_CACHE_SHA)
        .if_condition(Expression::new("steps.wasm.outputs.key != ''"))
        .continue_on_error(true)
        .timeout_minutes(WASM_CACHE_TIMEOUT_MINUTES)
        .add_with(("path", vars::DEPLOY_WASM_PKG_CACHE_DIR))
        .add_with(("key", "${{ steps.wasm.outputs.key }}"))
}

/// Build identical across dev/prod up to `MODE` (`just build-<env>`). Its
/// `build-wasm` dependency reuses every package the step above built.
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
