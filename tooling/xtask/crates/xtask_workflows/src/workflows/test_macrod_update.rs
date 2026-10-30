//! `Test macrod update` — macrod's self-update and installers, end to end, on
//! Linux, macOS, and Windows.
//!
//! Each job builds macrod twice from the checkout, as two fake release tags,
//! and runs `crates/coding_agent_worker/e2e/` against a local release mirror:
//! the hot handoff and its negative cases plus the shell installer on Linux
//! and macOS, and the launcher layout plus `install.ps1` on Windows. Nothing
//! is published. Runs on pull requests that touch macrod, and on demand.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, Run, Step, Workflow};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

const E2E: &str = "crates/coding_agent_worker/e2e";
const V1: &str = "v2000.1.1.1";
const V2: &str = "v2000.1.1.2";

/// Build the workflow.
pub fn test_macrod_update() -> Workflow {
    Workflow::new("Test macrod update")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .pull_request(
                PullRequest::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!("crates/coding_agent_worker/**"))
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/test_macrod_update.yml"
                    )),
            )
            .workflow_dispatch(gh_workflow::WorkflowDispatch::default()))
        .add_job("linux", linux_job())
        .add_job("macos", macos_job())
        .add_job("windows", windows_job())
}

/// Builds musl like the release workflow, in the same minimal Nix shell.
fn linux_job() -> Job {
    Job::default()
        .name("macrod update (linux)")
        .runs_on(runners::Runner::RustCi.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::setup_dev_shell_named("agent-daemon"))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(
            build_step()
                .add_env(("TARGET", "x86_64-unknown-linux-musl"))
                .add_env(("CARGO_BUILD", "cargo zigbuild"))
                .add_env(("AWS_LC_SYS_CMAKE_BUILDER", "1")),
        )
        .add_step(update_step())
        .add_step(
            Step::new("Installer in bash, zsh and fish")
                .run(format!(
                    "nix shell nixpkgs#zsh nixpkgs#fish --command {E2E}/installer_test.sh \"$RUNNER_TEMP/releases\" {V1}"
                ))
                .shell("bash"),
        )
        .add_step(steps::teardown_nix())
}

fn macos_job() -> Job {
    Job::default()
        .name("macrod update (macos)")
        .runs_on(runners::Runner::MacOsArm.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_rust_light())
        .add_step(build_step())
        .add_step(update_step())
        .add_step(
            Step::new("Installer in bash and zsh")
                .run(format!(
                    "{E2E}/installer_test.sh \"$RUNNER_TEMP/releases\" {V1}"
                ))
                .shell("bash")
                .add_env(("INSTALLER_TEST_SHELLS", "bash zsh")),
        )
}

/// Windows has no hot handoff: this checks the launcher layout and the
/// installer, with builds from the runner's MSVC toolchain.
fn windows_job() -> Job {
    Job::default()
        .name("macrod update (windows)")
        .runs_on(runners::Runner::Windows.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_rust_light())
        .add_step(
            build_step()
                // aws-lc-sys ships its NASM objects pre-assembled.
                .add_env(("AWS_LC_SYS_PREBUILT_NASM", "1")),
        )
        .add_step(
            Step::new("Launcher layout and install.ps1")
                .run(format!(
                    "& ./{E2E}/windows_test.ps1 -Releases \"$env:RUNNER_TEMP/releases\" -V1 {V1} -V2 {V2}"
                ))
                .shell("pwsh"),
        )
        .add_step(
            Step::new("Self-update end to end")
                .run(format!(
                    "& ./{E2E}/windows_update_test.ps1 -Releases \"$env:RUNNER_TEMP/releases\" -V1 {V1} -V2 {V2}"
                ))
                .shell("pwsh"),
        )
}

fn build_step() -> Step<Run> {
    Step::new("Build two tagged releases")
        .run(format!(
            "{E2E}/build_releases.sh \"$RUNNER_TEMP/releases\" {V1} {V2}"
        ))
        .shell("bash")
        .add_env(("SQLX_OFFLINE", "true"))
}

fn update_step() -> Step<Run> {
    Step::new("Self-update end to end")
        .run(format!(
            "python3 {E2E}/update_e2e.py --releases \"$RUNNER_TEMP/releases\" --v1 {V1} --v2 {V2}"
        ))
        .shell("bash")
}
