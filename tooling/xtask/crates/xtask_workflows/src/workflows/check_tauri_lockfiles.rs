//! `check tauri lockfiles` — resolves both Tauri Cargo workspaces offline
//! against their Nix vendor dirs. The macOS release builds the desktop-cef
//! workspace, whose lockfile drifts silently when a shared `src-tauri`
//! dependency changes; this catches it on the PR instead of the next release.
//! Generated into `check_tauri_lockfiles.yml`.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn check_tauri_lockfiles() -> Workflow {
    Workflow::new("check tauri lockfiles")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("apps/web/tauri/**"))
                // Repository crates the Tauri workspaces reach by path, and the
                // root workspace they inherit dependencies from.
                .add_path(xtask_paths::repo_glob!("crates/**/Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                .add_path(xtask_paths::repo_glob!("nix/tauri-desktop.nix"))
                .add_path(xtask_paths::repo_glob!("flake.nix"))
                .add_path(xtask_paths::repo_glob!("flake.lock"))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/check_tauri_lockfiles.yml"
                )),
        ))
        .add_job("check-tauri-lockfiles", check_tauri_lockfiles_job())
}

fn check_tauri_lockfiles_job() -> Job {
    Job::default()
        .name("check Tauri lockfiles")
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(
            Step::new("Resolve Tauri lockfiles offline")
                .run("nix build --no-link -L .#checks.x86_64-linux.tauri-cargo-lockfiles"),
        )
        .add_step(steps::teardown_nix())
}
