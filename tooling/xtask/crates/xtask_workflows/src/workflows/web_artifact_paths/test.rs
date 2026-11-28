use std::collections::BTreeSet;

use super::*;

fn covered(glob_prefixes: &[&str], dir: &str) -> bool {
    glob_prefixes
        .iter()
        .any(|prefix| dir == *prefix || dir.starts_with(&format!("{prefix}/")))
}

/// Every workspace crate a wasm32 build of a web WASM package compiles, as
/// `cargo x deps` writes them (`wasm_closures`, one entry per package
/// `apps/web/justfile` builds), must be under a listed glob: a change to any
/// of them changes the shipped app, so its web checks and Cache Harness run.
#[test]
fn paths_cover_every_crate_a_web_wasm_package_compiles() {
    let root = xtask_paths::repo_root();
    let closures: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(".github/workspace-dep-closures.json"))
            .expect("read the closure map"),
    )
    .expect("parse the closure map");
    let packages = closures["wasm_closures"]
        .as_object()
        .expect("the closure map has wasm_closures");
    assert!(!packages.is_empty(), "wasm_closures is empty");
    let prefixes: Vec<&str> = WEB_ARTIFACT_PATHS
        .iter()
        .filter_map(|glob| glob.as_str().strip_suffix("/**"))
        .collect();
    let mut missing = BTreeSet::new();
    for (package, dirs) in packages {
        for dir in dirs.as_array().expect("a closure is a list") {
            let dir = dir.as_str().expect("a closure entry is a path");
            if !covered(&prefixes, dir) {
                missing.insert(format!("{dir} (built by {package})"));
            }
        }
    }
    assert!(
        missing.is_empty(),
        "WEB_ARTIFACT_PATHS has no glob for: {missing:#?}"
    );
}

/// The WASM builds' other inputs: the toolchain, the Cargo configuration
/// (target flags), and the Nix flake and dev shell that choose wasm-pack,
/// wasm-bindgen and binaryen. `apps/web/scripts/wasm-cache-key.ts` rebuilds a
/// package when one changes, so the web checks must run too.
#[test]
fn paths_cover_the_wasm_build_tools() {
    for path in [
        "rust-toolchain.toml",
        ".cargo/config.toml",
        "flake.lock",
        "flake.nix",
        "nix/cloud-storage.nix",
    ] {
        assert!(
            WEB_ARTIFACT_PATHS.iter().any(|glob| glob.as_str() == path),
            "WEB_ARTIFACT_PATHS has no entry for {path}"
        );
    }
}
