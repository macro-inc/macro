//! `Build Web App` — builds apps/web for one environment and uploads `dist` as
//! the [`artifact`] run artifact. Call-only: [`crate::workflows::deploy_web_app`]
//! uses it for standalone deploys, and [`crate::workflows::deploy_on_push`] and
//! [`crate::workflows::release_production`] call it directly so the build
//! overlaps the backend deploy and only the upload waits for it. Generated into
//! `build_web_app.yml`.

use std::fmt::Display;

use gh_workflow::expr::typed::{Expr, Num, StepHandle, StepOutput, Str, github, input};
use gh_workflow::{
    Env, Event, Job, Run, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret, WorkflowInput,
    ZizmorRule,
};

use crate::workflows::actions::{
    ActionsCacheRestore, ActionsCacheSave, ActionsCheckout, ActionsUploadArtifact,
};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// The `dist` artifact for `environment`, a name or this workflow's
/// [`environment`] input. Artifacts are scoped to the workflow run, and a
/// called workflow shares its caller's run, so the deploy job finds this
/// regardless of which workflow called the build.
pub fn artifact(environment: impl Display) -> String {
    format!("web-app-dist-{environment}")
}

/// The `environment` input of this workflow and of
/// [`crate::workflows::deploy_web_app`].
pub fn environment() -> Expr<Str> {
    input("environment")
}

pub fn build_web_app() -> Workflow {
    Workflow::new("Build Web App")
        .on(Event::default().workflow_call(
            WorkflowCall::default()
                .add_input(
                    "environment",
                    WorkflowInput::string()
                        .description("The environment to build for. e.g. (dev, prod)")
                        .required(true),
                )
                .add_secret(
                    "SEGMENT_WRITE_KEY",
                    WorkflowCallSecret::default().required(true),
                )
                .add_secret(
                    "POSTHOG_API_KEY",
                    WorkflowCallSecret::default().required(true),
                ),
        ))
        .add_job("build", build_job())
}

/// Wasm packages whose inputs did not change come from a GitHub Actions cache
/// instead of being rebuilt with LTO. A run on a branch only reads its own
/// scope and the default branch's, so a pull request cannot write what a deploy
/// reads; the Namespace HTTP cache PR jobs share stays off here.
///
/// What dev deploys on main save there, production releases restore. So no
/// deploy build reads the shared Namespace `web-ci` sccache or the cargo and
/// wasm-pack directories on the `web-ci` cache volume, which pull request jobs
/// write: from the volume it mounts only the Nix store and Bun's package cache,
/// as the production release's own build job did, and it compiles Rust with a
/// local sccache.
fn build_job() -> Job {
    Job::default()
        .name("Build")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_env(("CI", "true"))
        .add_env(("WASM_PKG_CACHE_DIR", vars::DEPLOY_WASM_PKG_CACHE_DIR))
        .add_step(checkout().zizmor_ignore(
            ZizmorRule::Artipacked,
            "`just build-*` runs the web build scripts",
        ))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
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
    ActionsCheckout::new("Checkout Repo")
        .r#ref(github().sha())
        .step()
}

/// Saved entries are named by the set of package keys they hold plus the run
/// that saved them (`scripts/deploy_build_wasm.sh`), and the newest one in
/// scope is restored. A run name keeps a set that comes back, say after a
/// revert, saveable again: Actions cache entries cannot be overwritten.
///
/// `v1` sets were built with the `web-ci` sccache and the volume's cargo and
/// wasm-pack directories, which pull requests write.
const WASM_PACKAGES_KEY_PREFIX: &str = "deploy-wasm-pkgs-v2-";

/// The packages are tens of megabytes. A transfer that stalls gives up and the
/// build goes on without them rather than holding the deploy.
const WASM_CACHE_TIMEOUT_MINUTES: u32 = 3;

pub(crate) struct RestoreWasmOutputs {
    /// The key of the cache entry the restore matched, if any.
    pub cache_matched_key: StepOutput<Str>,
}

/// The step that restores cached wasm packages.
pub(crate) const RESTORE_WASM: StepHandle<RestoreWasmOutputs> = StepHandle::new(
    "restore-wasm",
    RestoreWasmOutputs {
        cache_matched_key: ActionsCacheRestore::cache_matched_key_output("restore-wasm"),
    },
);

pub(crate) struct WasmOutputs {
    /// The key to save the built packages under, or empty when nothing to save.
    pub key: StepOutput<Str>,
}

/// The step that builds the wasm packages.
pub(crate) const WASM: StepHandle<WasmOutputs> = StepHandle::new(
    "wasm",
    WasmOutputs {
        key: StepOutput::new("wasm", "key"),
    },
);

fn restore_wasm_packages() -> Step<Use> {
    ActionsCacheRestore::new(
        "Restore wasm packages",
        vars::DEPLOY_WASM_PKG_CACHE_DIR,
        format!("{WASM_PACKAGES_KEY_PREFIX}{}", github().sha()),
    )
    .restore_keys(WASM_PACKAGES_KEY_PREFIX)
    .step()
    .id(RESTORE_WASM.id())
    .continue_on_error(true)
    .timeout_minutes(WASM_CACHE_TIMEOUT_MINUTES)
}

/// Its own step, saved before the app build, so a run whose app build fails
/// still keeps its packages. It names the set to save, or nothing when the
/// restored entry already holds it.
fn build_wasm_packages() -> Step<Run> {
    Step::new("Build wasm packages")
        .run(include_str!("scripts/deploy_build_wasm.sh"))
        .id(WASM.id())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("KEY_PREFIX", WASM_PACKAGES_KEY_PREFIX))
        .add_env((
            "RESTORED_KEY",
            RESTORE_WASM.outputs.cache_matched_key.read(),
        ))
}

fn save_wasm_packages() -> Step<Use> {
    ActionsCacheSave::new(
        "Save wasm packages",
        vars::DEPLOY_WASM_PKG_CACHE_DIR,
        WASM.outputs.key.read(),
    )
    .step()
    .if_condition(WASM.outputs.key.read().ne(""))
    .continue_on_error(true)
    .timeout_minutes(WASM_CACHE_TIMEOUT_MINUTES)
}

/// Build identical across dev/prod up to `MODE` (`just build-<env>`). Its
/// `build-wasm` dependency reuses every package the step above built.
fn build() -> Step<Run> {
    Step::new("Build")
        .run("just \"build-$DEPLOY_ENVIRONMENT\"")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(Env::new("VITE_SEGMENT_WRITE_KEY", vars::SEGMENT_WRITE_KEY))
        .add_env(Env::new("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
        .add_env(Env::new(
            "VITE_OTEL_EXPORTER_URL",
            environment().eq("prod").then_else(
                "https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces",
                "https://macro-prox-dev.macroverse.workers.dev/i/otlp/v1/traces",
            ),
        ))
        .add_env(Env::new(
            "VITE_OTEL_ENV",
            environment().eq("prod").then_else("prod", "development"),
        ))
}

fn upload_dist() -> Step<Use> {
    ActionsUploadArtifact::new(
        "Upload dist",
        xtask_paths::runtime_path!("apps/web/dist").as_str(),
    )
    .name(artifact(environment()))
    .if_no_files_found("error")
    // The production release kept its build a week, so a failed release
    // job can still be re-run days later.
    .retention_days(environment().eq("prod").then_else::<Num>(7_i64, 1_i64))
    // A full re-run of the same run uploads again under the same name.
    .overwrite(true)
    .step()
}
