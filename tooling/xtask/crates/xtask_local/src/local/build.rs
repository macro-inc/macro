//! The Rust build + runtime-image contract.
//!
//! Binaries are built natively on the host with `cargo build` (or consumed from
//! a prebuilt Nix/crane dir) and bind-mounted read-only into a minimal runtime
//! image at `/app/out`. Docker never compiles Rust. Re-building binaries +
//! restarting a container picks up code changes with no image rebuild.

mod binaries_dir;
mod cargo_build;
mod dep_cache;
mod runtime_image;

#[cfg(test)]
mod test;

pub use binaries_dir::{Adoption, BinariesDir};
pub use runtime_image::{ensure_runtime_image, runtime_image_tag};

use anyhow::Result;

use super::arch::Target;
use super::inventory::RustService;
use super::stage::Stage;

/// How the caller wants binaries sourced.
pub struct BuildOptions {
    /// Skip building; reuse whatever is already in the default target dir.
    pub no_build: bool,
    /// Use this directory as the `/app/out` source instead of building.
    pub binaries_dir: Option<std::path::PathBuf>,
    /// Build only these services' binaries; `None` builds them all.
    pub only: Option<Vec<&'static RustService>>,
}

/// Resolve a [`BinariesDir`] for the run: from `--binaries-dir`, from the
/// existing target dir (`--no-build`), or by building with cargo.
pub fn resolve(stage: &Stage, target: Target, opts: &BuildOptions) -> Result<BinariesDir> {
    let dir = source(stage, target, opts)?;
    dir.validate(&super::inventory::local_binaries())?;
    Ok(dir)
}

/// [`resolve`] for a bring-up that runs only `services` from `/app/out`, such
/// as an infra-only stack's emulators: builds and checks just those.
pub fn resolve_services(
    stage: &Stage,
    target: Target,
    no_build: bool,
    binaries_dir: Option<std::path::PathBuf>,
    services: Vec<&'static RustService>,
) -> Result<BinariesDir> {
    if binaries_dir.is_none() && (services.is_empty() || stage.is_dry_run()) {
        if stage.is_dry_run() && !no_build && !services.is_empty() {
            cargo_build::run(stage, target, Some(&services))?;
        }
        // Compose still mounts `/app/out` when nothing runs there. A preview
        // also needs only its path, since it skipped creating the binaries.
        return Ok(BinariesDir::TargetDir(
            super::workspace_root().join(target.debug_dir()),
        ));
    }
    let binaries: Vec<&str> = services.iter().map(|service| service.cargo_bin).collect();
    let dir = source(
        stage,
        target,
        &BuildOptions {
            no_build,
            binaries_dir,
            only: Some(services),
        },
    )?;
    dir.validate(&binaries)?;
    Ok(dir)
}

fn source(stage: &Stage, target: Target, opts: &BuildOptions) -> Result<BinariesDir> {
    Ok(match &opts.binaries_dir {
        Some(dir) => BinariesDir::classify(dir)?,
        None if opts.no_build => {
            super::arch::ensure_linux_host()?;
            BinariesDir::classify(&super::workspace_root().join(target.debug_dir()))?
        }
        None => {
            super::arch::ensure_linux_host()?;
            cargo_build::run(stage, target, opts.only.as_deref())?;
            BinariesDir::classify(&super::workspace_root().join(target.debug_dir()))?
        }
    })
}
