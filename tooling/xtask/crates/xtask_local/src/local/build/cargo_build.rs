//! Native build of the local service binaries.
//!
//! The Nix dev shell supplies the compiler, linker, and C libraries, so the
//! binaries link Nix's glibc and libssl and run in the runtime image with
//! `/nix/store` mounted (see [`super::BinariesDir::compose_mounts`]).

use std::path::Path;
use std::process::Command;

use anyhow::Result;

use super::super::inventory::{RUST_SERVICES, RustService};
use super::super::{repo_root, stage::Stage, workspace_root};

#[cfg(test)]
mod test;

/// Directories whose `node_modules` the Rust build reads: `code_mode_assets`'
/// build script bundles the SDK with these dependencies, and fails late in a
/// cold build when they are missing.
const JS_DEPENDENCY_DIRS: &[&str] = &[".", "packages/sdk"];

/// Build every non-opt-in service binary (debug profile).
///
/// One invocation builds them all, with each service's extra features passed
/// package-qualified (`<package>/<feature>`) so they compose. A second
/// package-scoped invocation would resolve features over a different package
/// selection, and building it in this target dir invalidates shared dependency
/// artifacts on every run: keep a service's local behavior additive, as
/// `authentication_service`'s `no_rate_limit` and `search_processing_service`'s
/// `no_pdf` are.
pub fn run(stage: &Stage) -> Result<()> {
    ensure_js_dependencies(stage, &repo_root())?;

    let mut cmd = Command::new("cargo");
    cmd.current_dir(workspace_root())
        .arg("build")
        .args(build_args())
        .env("SQLX_OFFLINE", "true");
    stage.run("Building service binaries", &mut cmd)
}

/// Install JavaScript dependencies a fresh worktree doesn't have yet.
fn ensure_js_dependencies(stage: &Stage, root: &Path) -> Result<()> {
    for dir in missing_js_dependency_dirs(root) {
        let mut install = Command::new("bun");
        install
            .current_dir(root.join(dir))
            .args(["install", "--frozen-lockfile"]);
        stage.run(&format!("Installing JS dependencies ({dir})"), &mut install)?;
    }
    Ok(())
}

fn missing_js_dependency_dirs(root: &Path) -> Vec<&'static str> {
    JS_DEPENDENCY_DIRS
        .iter()
        .copied()
        .filter(|dir| !root.join(dir).join("node_modules").exists())
        .collect()
}

/// The services this build covers.
fn built_services() -> impl Iterator<Item = &'static RustService> {
    RUST_SERVICES.iter().filter(|s| !s.is_opt_in())
}

/// `--bin` per service plus one `--features` carrying every service's local
/// features, package-qualified so a feature only reaches the package that
/// declares it.
fn build_args() -> Vec<String> {
    let mut args: Vec<String> = built_services()
        .flat_map(|svc| ["--bin".to_owned(), svc.cargo_bin.to_owned()])
        .collect();
    let features: Vec<String> = built_services()
        .flat_map(|svc| {
            svc.local_features()
                .iter()
                .map(|f| format!("{}/{f}", svc.package))
        })
        .collect();
    if !features.is_empty() {
        args.push("--features".to_owned());
        args.push(features.join(","));
    }
    args
}
