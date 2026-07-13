//! The Rust build + runtime-image contract.
//!
//! Binaries are built on the host with `cargo zigbuild` (or consumed from a
//! prebuilt Nix/crane dir) and bind-mounted read-only into a minimal runtime
//! image at `/app/out`. Docker never compiles Rust. Re-building binaries +
//! restarting a container picks up code changes with no image rebuild.

mod binaries_dir;
mod runtime_image;
mod zigbuild;

pub use binaries_dir::BinariesDir;
pub use runtime_image::{RUNTIME_IMAGE_TAG, ensure_runtime_image};

use anyhow::Result;

use super::arch::Target;
use super::stage::Stage;

/// How the caller wants binaries sourced.
pub struct BuildOptions {
    /// Skip building; reuse whatever is already in the default target dir.
    pub no_build: bool,
    /// Use this directory as the `/app/out` source instead of building.
    pub binaries_dir: Option<std::path::PathBuf>,
}

/// Resolve a [`BinariesDir`] for the run: from `--binaries-dir`, from the
/// existing target dir (`--no-build`), or by building with zigbuild.
pub fn resolve(stage: &Stage, target: Target, opts: &BuildOptions) -> Result<BinariesDir> {
    let dir = match &opts.binaries_dir {
        Some(dir) => BinariesDir::classify(dir)?,
        None if opts.no_build => {
            BinariesDir::classify(&super::workspace_root().join(target.debug_dir()))?
        }
        None => {
            zigbuild::run(stage, target)?;
            BinariesDir::classify(&super::workspace_root().join(target.debug_dir()))?
        }
    };
    dir.validate(&super::inventory::local_binaries())?;
    Ok(dir)
}
