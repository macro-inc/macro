//! `desktop check` — builds the desktop app's Rust (`apps/web/tauri`) and runs
//! its unit tests on Linux, for pull requests that change it. Two PRs that each
//! passed CI once broke the desktop build together, and nothing else compiles
//! it before a release tag does.
//!
//! The tests include the checks that the generated wire types in
//! `apps/web/src/observability/generated/` match the Rust (`*_wire_types`), and
//! the Linux notification tests, which start their own D-Bus daemon.
//! Generated into `desktop_check.yml`.

use gh_workflow::{Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{runners, steps, vars};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("apps/web/tauri/**"),
    xtask_paths::repo_glob!("apps/web/src/observability/generated/**"),
    xtask_paths::repo_glob!("nix/tauri-dev-shells.nix"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!(".github/workflows/desktop_check.yml"),
];

/// Build the workflow.
pub fn desktop_check() -> Workflow {
    Workflow::new("desktop check")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("test-linux", test_linux_job())
}

/// The packages whose library tests run: the app, and the bundle updater,
/// whose wire types the app's frontend also reads.
const TEST_COMMAND: &str = "cargo test --manifest-path apps/web/tauri/Cargo.toml --locked \
     --no-fail-fast -p app -p macro_bundle_updater_plugin --lib";

fn test_linux_job() -> Job {
    Job::default()
        .timeout_minutes(40u32)
        .name("Test on Linux")
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::DESKTOP_CI_CACHE))
        // sccache can't cache incremental builds.
        .add_env(("CARGO_INCREMENTAL", "0"))
        .add_env(("CARGO_TERM_COLOR", "always"))
        .add_env(("CARGO_PROFILE_DEV_DEBUG", "limited"))
        .add_env(("RUST_BACKTRACE", "1"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_desktop_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            steps::setup_dev_shell_named("tauri-linux")
                .timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES),
        )
        .add_step(steps::configure_namespace_sccache(vars::DESKTOP_CI_CACHE))
        .add_step(stub_frontend())
        .add_step(Step::new("cargo test (desktop app)").run(TEST_COMMAND))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// What the app's build needs from a frontend build, without building one, as
/// `desktop_qa_macos.yml` does: `tauri::generate_context!` needs the frontend
/// directory to exist, and a development `.macro-tauri-env` lets `build.rs`
/// fall back to bundle build 0 instead of requiring the bundle manifest.
fn stub_frontend() -> Step<Run> {
    Step::new("Stub the frontend build").run(indoc::indoc! {r#"
        mkdir -p apps/web/dist
        echo '<!doctype html>' > apps/web/dist/index.html
        echo development > apps/web/tauri/src-tauri/.macro-tauri-env
    "#})
}
