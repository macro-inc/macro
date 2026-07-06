//! Host-side cross-compile of the local service binaries via `cargo zigbuild`.
//!
//! Mirrors the env the Lambda builds use in flake.nix (`lambdaCommonArgs`):
//! cleared RUSTFLAGS (zig links, so drop mold/lld), the glibc-pinned target,
//! `AWS_LC_SYS_CMAKE_BUILDER=1` (aws-lc-sys's cc-builder rejects the zig C
//! compiler), `SQLX_OFFLINE`, and writable zig cache dirs.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::super::arch::Target;
use super::super::inventory::RUST_SERVICES;
use super::super::{stage::Stage, workspace_root};

/// Build every non-opt-in service binary (debug profile) for `target`.
///
/// Most bins build together in one invocation; bins that need
/// `--no-default-features` (e.g. `authentication_service`, to drop `rate_limit`)
/// build in their own invocation since `--no-default-features` is package-wide.
// xtask is host tooling; reading CARGO_BUILD_JOBS from the process env is correct.
#[allow(clippy::disallowed_methods)]
pub fn run(stage: &Stage, target: Target) -> Result<()> {
    ensure_target_installed(target)?;

    let ws = workspace_root();
    let zig_cache = ws.join("target/zig-cache");
    let jobs = std::env::var("CARGO_BUILD_JOBS")
        .ok()
        .filter(|j| !j.is_empty() && j != "0")
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1)
                .to_string()
        });

    // Group 1: default-feature bins, all in one invocation.
    let default_bins: Vec<&str> = RUST_SERVICES
        .iter()
        .filter(|s| !s.is_opt_in() && !s.no_default_features)
        .map(|s| s.cargo_bin)
        .collect();
    let mut cmd = base_command(&ws, &zig_cache, &jobs, target);
    for bin in &default_bins {
        cmd.arg("--bin").arg(bin);
    }
    stage.run(
        &format!("Building service binaries ({})", target.triple),
        &mut cmd,
    )?;

    // Group 2: each --no-default-features bin in its own package-scoped invocation.
    for svc in RUST_SERVICES
        .iter()
        .filter(|s| !s.is_opt_in() && s.no_default_features)
    {
        let mut cmd = base_command(&ws, &zig_cache, &jobs, target);
        cmd.arg("-p")
            .arg(svc.package)
            .arg("--no-default-features")
            .arg("--bin")
            .arg(svc.cargo_bin);
        let features = svc.build_features();
        if !features.is_empty() {
            cmd.arg("--features").arg(features.join(","));
        }
        stage.run(
            &format!("Building {} (no default features)", svc.cargo_bin),
            &mut cmd,
        )?;
    }

    Ok(())
}

/// A `cargo zigbuild` command with the shared env (mirrors flake.nix
/// `lambdaCommonArgs`).
fn base_command(ws: &Path, zig_cache: &Path, jobs: &str, target: Target) -> Command {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(ws)
        .arg("zigbuild")
        .arg("--target")
        .arg(target.zig_target())
        .arg("-j")
        .arg(jobs)
        .env("SQLX_OFFLINE", "true")
        .env("CARGO_PROFILE_DEV_DEBUG", "0")
        .env("AWS_LC_SYS_CMAKE_BUILDER", "1")
        .env("ZIG_GLOBAL_CACHE_DIR", zig_cache)
        .env("ZIG_LOCAL_CACHE_DIR", zig_cache)
        .env("RUSTC_WRAPPER", "sccache")
        .env("XDG_CACHE_HOME", zig_cache);
    cmd
}

/// Fail with an actionable hint if the rust-std for `target` is not installed.
/// The repo's `rustup` is a no-op shim, so the only fix is adding the triple to
/// `rust/rust-toolchain.toml` and re-entering `nix develop`.
fn ensure_target_installed(target: Target) -> Result<()> {
    let sysroot = Command::new("rustc")
        .args(["--print", "sysroot"])
        .output()
        .context("running `rustc --print sysroot`")?;
    if !sysroot.status.success() {
        bail!("could not determine rustc sysroot (is the toolchain installed?)");
    }
    let sysroot = String::from_utf8_lossy(&sysroot.stdout).trim().to_string();
    let std_dir = std::path::Path::new(&sysroot)
        .join("lib/rustlib")
        .join(target.triple);
    if !std_dir.exists() {
        bail!(
            "rust target {} is not installed (no std at {}).\n  \
             Add it to rust/rust-toolchain.toml `targets` and re-enter `nix develop` \
             (the repo's rustup is a shim and cannot install targets).",
            target.triple,
            std_dir.display()
        );
    }
    Ok(())
}
