//! Repo automation tasks (the cargo-xtask pattern).
//!
//! `cargo run -p xtask -- deps [--check]` regenerates (or, with `--check`,
//! verifies) the two generated dependency artifacts:
//!
//! - `workspace-hack/Cargo.toml` (via the hakari engine): pins every
//!   third-party dep to its union feature set so a solo `cargo build -p X`
//!   resolves the same features as the union-built crane dep layers, keeping
//!   the warm dependency caches exact fingerprint matches.
//! - `.github/workspace-dep-closures.json`: every workspace crate's
//!   transitive workspace dependency closure, consumed by flake.nix to build
//!   pruned per-artifact deploy sources.
//!
//! Both run from the hakari/guppy versions pinned in Cargo.lock, so local
//! runs and CI cannot disagree about generator versions. `just hakari` wraps
//! the regenerate mode; CI runs `--check` and fails on drift.

mod closures;
mod hakari_ops;

use std::path::Path;

use anyhow::{bail, Context, Result};
use guppy::graph::PackageGraph;
use guppy::MetadataCommand;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let check = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["deps"] => false,
        ["deps", "--check"] => true,
        _ => bail!("usage: cargo run -p xtask -- deps [--check]"),
    };

    let graph = build_graph(check)?;

    let mut drift: Vec<String> = Vec::new();
    let hakari_changed = hakari_ops::run(&graph, check, &mut drift)?;

    // The hakari step may have edited manifests (hack contents or member dep
    // lines); recompute the graph so the closure map sees the result. The
    // fresh `cargo metadata` also refreshes Cargo.lock after those edits.
    let graph = if hakari_changed {
        build_graph(false)?
    } else {
        graph
    };
    closures::run(&graph, check, &mut drift)?;

    if !drift.is_empty() {
        bail!(
            "generated dependency artifacts are stale:\n  - {}\nrun `just hakari` (or `cargo run -p xtask -- deps`) from rust/cloud-storage and commit the result",
            drift.join("\n  - ")
        );
    }
    Ok(())
}

fn build_graph(locked: bool) -> Result<PackageGraph> {
    // Anchor on the manifest dir, not the invocation cwd, so the task works
    // from anywhere in the repo. The crate lives at <workspace>/tools/xtask.
    let workspace_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .context("xtask manifest dir has no workspace root two levels up")?
        .to_owned();
    let mut cmd = MetadataCommand::new();
    cmd.current_dir(&workspace_dir);
    if locked {
        // In check mode a stale lockfile is itself drift; surface it instead
        // of silently rewriting it.
        cmd.other_options(vec!["--locked".to_owned()]);
    }
    cmd.build_graph().with_context(|| {
        if locked {
            "running cargo metadata --locked (a stale Cargo.lock is drift: run `just hakari` and commit)"
        } else {
            "running cargo metadata"
        }
    })
}
