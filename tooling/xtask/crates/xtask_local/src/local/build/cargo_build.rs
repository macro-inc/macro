//! Native build of the local service binaries.
//!
//! The Nix dev shell supplies the compiler, linker, and C libraries, so the
//! binaries link Nix's glibc and libssl and run in the runtime image with
//! `/nix/store` mounted (see [`super::BinariesDir::compose_mounts`]).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::super::arch::Target;
use super::super::inventory::{RUST_SERVICES, RustService};
use super::super::{repo_root, stage::Stage, workspace_root};
use super::dep_cache;

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
///
/// A target with none of the registry dependencies built yet is first seeded
/// from the machine's [`dep_cache`] (once per cache entry), and a build whose
/// dependencies aren't cached yet saves them there afterwards. Cache failures
/// are reported and skipped: they only cost time, since cargo still decides
/// what is fresh.
pub fn run(stage: &Stage, target: Target) -> Result<()> {
    ensure_js_dependencies(stage, &repo_root())?;

    let ws = workspace_root();
    let target_debug = ws.join(target.debug_dir());
    let args = build_args();
    let entry = cache_entry(&ws, &args).inspect_err(|err| {
        stage.note(&format!("Dependency cache skipped: {err:#}"));
    });
    let entry = entry.ok();

    if let Some(entry) = &entry
        && dep_cache::is_complete(entry)
        && !dep_cache::is_seeded(&target_debug, entry)
    {
        let mut overlap = 0;
        let seeded = stage.run_step("Seeding dependencies from the machine cache", || {
            if let dep_cache::Seeded::Overlap(units) = dep_cache::seed(entry, &target_debug)? {
                overlap = units;
            }
            dep_cache::mark_seeded(&target_debug, entry)
        });
        if overlap > 0 {
            stage.note(&format!(
                "Dependency seed skipped: target/ already built {overlap} of its units"
            ));
        }
        if let Err(err) = seeded {
            stage.note(&format!(
                "Dependency seed incomplete, cargo rebuilds the rest: {err:#}"
            ));
        }
    }

    let mut cmd = Command::new("cargo");
    cmd.current_dir(&ws)
        .arg("build")
        .args(&args)
        .env("SQLX_OFFLINE", "true");
    stage.run("Building service binaries", &mut cmd)?;

    if let Some(entry) = &entry
        && !dep_cache::is_complete(entry)
    {
        let saved = stage.run_step("Saving dependencies to the machine cache", || {
            let packages = workspace_packages(&ws)?;
            dep_cache::save(entry, &target_debug, &packages)?;
            dep_cache::mark_seeded(&target_debug, entry)?;
            if let Some(root) = entry.parent() {
                dep_cache::evict(root, dep_cache::keep_entries())?;
            }
            Ok(())
        });
        if let Err(err) = saved {
            stage.note(&format!("Dependency cache not saved: {err:#}"));
        }
    }
    Ok(())
}

/// The cache entry for building `args` in `ws`.
fn cache_entry(ws: &Path, args: &[String]) -> Result<PathBuf> {
    let root = dep_cache::root_dir().context("no cache directory (HOME is unset)")?;
    Ok(root.join(dep_cache::Key::current(ws, args)?.digest()))
}

/// Names of the workspace's own packages, which the cache leaves out.
fn workspace_packages(ws: &Path) -> Result<HashSet<String>> {
    let out = Command::new("cargo")
        .current_dir(ws)
        .args([
            "metadata",
            "--no-deps",
            "--format-version",
            "1",
            "--offline",
        ])
        .output()
        .context("running `cargo metadata`")?;
    if !out.status.success() {
        bail!(
            "`cargo metadata` failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let meta: serde_json::Value =
        serde_json::from_slice(&out.stdout).context("parsing `cargo metadata`")?;
    let packages = meta["packages"]
        .as_array()
        .context("`cargo metadata` has no packages")?
        .iter()
        .filter_map(|p| p["name"].as_str().map(str::to_owned))
        .collect();
    Ok(packages)
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
