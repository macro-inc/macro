#![deny(missing_docs)]
//! Shared path discovery for the xtask command crates.
//!
//! Every xtask command needs to locate the cloud-storage workspace root (to
//! anchor `cargo metadata`, read member manifests, spawn `wasm-pack`, …) and
//! the repository root above it (where `docker-compose.yml`, `infra/`, `js/`,
//! and the root `justfile` live). Both are derived from this crate's own
//! manifest dir rather than the invocation cwd, so the commands work from
//! anywhere in the repo.
//!
//! Centralizing the ancestor walk here means the hardcoded depth lives in one
//! place: this crate sits at `<workspace>/tools/xtask/crates/xtask-paths`, so
//! the workspace root is four levels up regardless of which command crate
//! calls in.

use std::path::{Path, PathBuf};

/// The cloud-storage cargo workspace root (`rust/cloud-storage`).
///
/// `env!("CARGO_MANIFEST_DIR")` expands to this crate's directory, which is a
/// fixed location, so the depth here does not depend on the caller.
pub fn workspace_root() -> PathBuf {
    // <workspace>/tools/xtask/crates/xtask-paths -> nth(4) == <workspace>.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("xtask-paths manifest dir has no workspace root four levels up")
        .to_owned()
}

/// The repository root (two levels above the cloud-storage workspace:
/// `<repo>/rust/cloud-storage`).
pub fn repo_root() -> PathBuf {
    workspace_root()
        .ancestors()
        .nth(2)
        .expect("cloud-storage workspace has no repo root two levels up")
        .to_owned()
}
