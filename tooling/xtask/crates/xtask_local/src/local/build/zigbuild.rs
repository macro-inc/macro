//! Host-side cross-compile of the local service binaries via `cargo zigbuild`.
//!
//! Mirrors the env the Lambda builds use in flake.nix (`lambdaCommonArgs`):
//! cleared RUSTFLAGS (zig links, so drop mold/lld), the glibc-pinned target,
//! `AWS_LC_SYS_CMAKE_BUILDER=1` (aws-lc-sys's cc-builder rejects the zig C
//! compiler), `SQLX_OFFLINE`, and writable zig cache dirs.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use super::super::arch::Target;
use super::super::inventory::{RUST_SERVICES, RustService};
use super::super::{stage::Stage, workspace_root};

#[cfg(test)]
mod test;

/// Build every non-opt-in service binary (debug profile) for `target`.
///
/// One unified invocation builds as many bins as possible, with each service's
/// extra features passed package-qualified (`<package>/<feature>`) so they
/// compose instead of forcing a separate build. Services that must drop a
/// *default* feature still need their own package-scoped invocation, and that
/// is expensive in a way that is invisible at the call site: a package-scoped
/// build resolves features over a different package selection, so it
/// invalidates shared dependency artifacts the unified build produced, and the
/// *next* run pays to rebuild them. Measured on a 12-core Linux host: with the
/// extra invocations, a `run_local` with zero source changes rebuilt 230 units
/// in 2m06s; unified, the same no-op build is 16s. Keep
/// [`RustService::no_default_features`] as close to empty as the features allow.
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

    let mut cmd = base_command(&ws, &zig_cache, &jobs, target);
    cmd.args(unified_args());
    stage.run(
        &format!("Building service binaries ({})", target.triple),
        &mut cmd,
    )?;

    // Each --no-default-features bin in its own package-scoped invocation, and
    // in its own target dir: that is what keeps its different feature
    // resolution from invalidating the unified build's shared artifacts (and
    // vice versa). Each dir then only ever sees one resolution, so both stay
    // incrementally fresh. Costs one cold build per dir, once.
    for svc in isolated_services() {
        let target_dir = isolated_target_dir(&ws, svc);
        let mut cmd = base_command(&ws, &zig_cache, &jobs, target);
        cmd.args(isolated_args(svc, &target_dir));
        stage.run(
            &format!("Building {} (no default features)", svc.cargo_bin),
            &mut cmd,
        )?;
        // The stack mounts one directory at `/app/out`, so land the binary
        // beside the unified ones. Skip the copy when dest is already current:
        // `std::fs::copy` always rewrites dest and the `r` hotkey keys off
        // dest mtime, so an unconditional copy would restart the isolated
        // service on every no-op rebuild.
        let built = target_dir
            .join(target.triple)
            .join("debug")
            .join(svc.cargo_bin);
        let dest = ws.join(target.debug_dir()).join(svc.cargo_bin);
        install_isolated_binary(&built, &dest)?;
    }

    Ok(())
}

/// Copy `src` onto `dest` only when dest is missing or older/different-sized.
/// After a no-op isolated build the dest from the previous copy is newer, so
/// this leaves its mtime alone and the `r` hotkey does not restart the bin.
fn install_isolated_binary(src: &Path, dest: &Path) -> Result<()> {
    if let (Ok(src_meta), Ok(dest_meta)) = (std::fs::metadata(src), std::fs::metadata(dest))
        && src_meta.len() == dest_meta.len()
        && src_meta.modified().ok() <= dest_meta.modified().ok()
    {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::copy(src, dest)
        .with_context(|| format!("copying {} to {}", src.display(), dest.display()))?;
    Ok(())
}

/// Where a `--no-default-features` service builds. Under `target/` so it is
/// covered by the same ignore rules and cleaned by `cargo clean`'s neighbors.
fn isolated_target_dir(ws: &Path, svc: &RustService) -> PathBuf {
    ws.join("target/local-isolated").join(svc.cargo_bin)
}

/// The services built together in the unified invocation.
fn unified_services() -> impl Iterator<Item = &'static RustService> {
    RUST_SERVICES
        .iter()
        .filter(|s| !s.is_opt_in() && !s.no_default_features)
}

/// The services that need their own package-scoped, own-target-dir build.
fn isolated_services() -> impl Iterator<Item = &'static RustService> {
    RUST_SERVICES
        .iter()
        .filter(|s| !s.is_opt_in() && s.no_default_features)
}

/// `--bin` per service plus one `--features` carrying every service's local
/// features, package-qualified so a feature only reaches the package that
/// declares it.
fn unified_args() -> Vec<String> {
    let mut args: Vec<String> = unified_services()
        .flat_map(|svc| ["--bin".to_owned(), svc.cargo_bin.to_owned()])
        .collect();
    let features: Vec<String> = unified_services()
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

fn isolated_args(svc: &RustService, target_dir: &Path) -> Vec<String> {
    let mut args = vec![
        "--target-dir".to_owned(),
        target_dir.display().to_string(),
        "-p".to_owned(),
        svc.package.to_owned(),
        "--no-default-features".to_owned(),
        "--bin".to_owned(),
        svc.cargo_bin.to_owned(),
    ];
    let features = svc.local_features();
    if !features.is_empty() {
        args.push("--features".to_owned());
        args.push(features.join(","));
    }
    args
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
        // The nix dev shell pins OPENSSL_NO_VENDOR=1 so host builds link the
        // Nix openssl, but that openssl can't serve the cross target (pkg-config
        // refuses cross lookups and the Nix .so's don't exist in the runtime
        // image). Force rdkafka's ssl-vendored feature back on for zigbuild;
        // outside the shell the variable is unset and this is a no-op.
        .env("OPENSSL_NO_VENDOR", "0")
        .env("ZIG_GLOBAL_CACHE_DIR", zig_cache)
        .env("ZIG_LOCAL_CACHE_DIR", zig_cache)
        .env("RUSTC_WRAPPER", "sccache")
        .env("XDG_CACHE_HOME", zig_cache);
    // No CFLAGS here. The dev shell already exports target-scoped
    // `CFLAGS_<triple>`/`CXXFLAGS_<triple>` pointing at curl.dev for exactly
    // this cross build (see `nix/cloud-storage.nix`). Setting our own spelling
    // of the same include path only differed textually — and cargo fingerprints
    // these env vars, so the two spellings alternating rebuilt aws-lc-sys and
    // everything downstream.
    cmd
}

/// Fail with an actionable hint if the rust-std for `target` is not installed.
/// The repo's `rustup` is a no-op shim, so the only fix is adding the triple to
/// `rust-toolchain.toml` and re-entering `nix develop`.
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
             Add it to rust-toolchain.toml `targets` and re-enter `nix develop` \
             (the repo's rustup is a shim and cannot install targets).",
            target.triple,
            std_dir.display()
        );
    }
    Ok(())
}
