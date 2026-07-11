//! `cargo x cache-wasm [--force]`
//!
//! Ensures the browser cache wasm package (`crates/client/cache-wasm`, built by
//! wasm-pack into the gitignored `apps/web/packages/graphql-cache/wasm/`) is
//! present and version-matched before the vite dev server starts. Without
//! it the cache worker's dynamic import 404s at runtime and the normalized
//! cache silently degrades to network-only.
//!
//! Staleness is judged by semver only: the version in the crate's
//! Cargo.toml vs the version wasm-pack wrote into the generated
//! package.json. **Bump `crates/client/cache-wasm`'s version whenever engine or
//! schema changes should reach dev machines.** CI app builds do not rely on
//! this check — they always rebuild (`just build-cache-wasm` → `--force`),
//! so deploys never depend on version-bump discipline.

use std::{path::Path, process::Command};

use anyhow::{Context, Result, bail};

const CRATE_REL: &str = "crates/client/cache-wasm";
const PKG_REL: &str = "apps/web/packages/graphql-cache/wasm";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let force = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [] => false,
        ["--force"] => true,
        _ => bail!("usage: cargo x cache-wasm [--force]"),
    };
    run(force)
}

fn run(force: bool) -> Result<()> {
    let workspace_dir = xtask_paths::workspace_root();
    let repo_root = xtask_paths::repo_root();

    let crate_version = crate_version(&workspace_dir.join(CRATE_REL).join("Cargo.toml"))?;
    let pkg_dir = repo_root.join(PKG_REL);
    let built_version = built_version(&pkg_dir.join("package.json"))?;

    if !force && built_version.as_deref() == Some(crate_version.as_str()) {
        println!("cache-wasm: up to date (v{crate_version})");
        return Ok(());
    }

    match &built_version {
        None => println!("cache-wasm: not built yet, building v{crate_version}"),
        Some(built) if force => {
            println!("cache-wasm: forced rebuild (built v{built}, crate v{crate_version})")
        }
        Some(built) => {
            println!("cache-wasm: built v{built} != crate v{crate_version}, rebuilding")
        }
    }

    let status = Command::new("wasm-pack")
        .current_dir(&workspace_dir)
        .arg("build")
        .arg(CRATE_REL)
        .arg("--target")
        .arg("web")
        .arg("--release")
        .arg("--out-dir")
        .arg(&pkg_dir)
        .status()
        .context(
            "running wasm-pack (missing? it ships in the nix dev shell — \
             enter it or install wasm-pack)",
        )?;
    if !status.success() {
        bail!("wasm-pack build failed with status {status}");
    }
    Ok(())
}

/// Reads `version = "…"` from the crate's `[package]` section. A focused
/// line scan (the first `version =` in the manifest precedes any other
/// section) keeps the task free of a toml dependency.
fn crate_version(manifest: &Path) -> Result<String> {
    let text = std::fs::read_to_string(manifest)
        .with_context(|| format!("reading {}", manifest.display()))?;
    text.lines()
        .map(str::trim)
        .find_map(|line| {
            line.strip_prefix("version = \"")
                .and_then(|rest| rest.strip_suffix('"'))
        })
        .map(str::to_string)
        .with_context(|| format!("no `version = \"…\"` line in {}", manifest.display()))
}

/// Version wasm-pack wrote into the generated package.json, or `None` when
/// the package has not been built (or is unreadable — treated as unbuilt so
/// a corrupt output dir heals via rebuild).
fn built_version(package_json: &Path) -> Result<Option<String>> {
    let text = match std::fs::read_to_string(package_json) {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(None),
    };
    Ok(parsed
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string))
}
