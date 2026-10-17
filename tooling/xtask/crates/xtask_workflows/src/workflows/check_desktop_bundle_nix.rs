//! `check desktop bundle nix` — builds the Nix desktop frontend that the
//! AppImage and DMG releases embed. The derivation runs
//! `apps/web/scripts/build-tauri-frontend.sh`, which fails when a WASM package,
//! a build-time env value from `apps/web/build-env.json`, or the commit is
//! missing from the bundle, so a change that breaks the
//! release build shows up on its pull request instead of on the release tag.
//! Generated into `check_desktop_bundle_nix.yml`.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, Step, Workflow};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn check_desktop_bundle_nix() -> Workflow {
    Workflow::new("check desktop bundle nix")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path(xtask_paths::repo_glob!("nix/tauri-desktop.nix"))
                .add_path(xtask_paths::repo_glob!("nix-support/node_modules.nix"))
                .add_path(xtask_paths::repo_glob!(
                    "nix-support/node_modules-hashes.json"
                ))
                .add_path(xtask_paths::repo_glob!("flake.nix"))
                .add_path(xtask_paths::repo_glob!("flake.lock"))
                .add_path(xtask_paths::repo_glob!("apps/web/wasm-packages.json"))
                .add_path(xtask_paths::repo_glob!("apps/web/build-env.json"))
                .add_path(xtask_paths::repo_glob!("apps/web/package.json"))
                .add_path(xtask_paths::repo_glob!("apps/web/vite.base.ts"))
                .add_path(xtask_paths::repo_glob!(
                    "apps/web/scripts/build-tauri-frontend.sh"
                ))
                .add_path(xtask_paths::repo_glob!(
                    "apps/web/scripts/verify-tauri-bundle.ts"
                ))
                .add_path(xtask_paths::repo_glob!("apps/web/scripts/wasm-packages.ts"))
                .add_path(xtask_paths::repo_glob!(
                    "apps/web/scripts/write-bundle-manifest.mjs"
                ))
                .add_path(xtask_paths::repo_glob!(
                    "apps/web/scripts/cache-wasm/cli.ts"
                ))
                .add_path(xtask_paths::repo_glob!(
                    ".github/workflows/check_desktop_bundle_nix.yml"
                )),
        ))
        .add_job("check-desktop-bundle-nix", check_desktop_bundle())
}

fn check_desktop_bundle() -> Job {
    Job::default()
        .name("check Linux desktop bundle nix")
        // Not the release jobs' `desktop-linux` volume: pull request code must
        // not write to the store the release builds read from.
        .runs_on(runners::Runner::Mid.with_cache_tag("desktop-bundle-check"))
        .timeout_minutes(90u32)
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(build_frontend())
        .add_step(steps::teardown_nix())
}

fn build_frontend() -> Step<gh_workflow::Run> {
    Step::new("build the desktop frontend and verify its bundle").run(indoc::indoc! {r#"
        nix build .#tauri-frontend \
          --option sandbox true \
          --print-build-logs \
          --no-link
    "#})
}
