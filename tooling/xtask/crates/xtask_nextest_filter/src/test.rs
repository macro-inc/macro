use super::*;

/// A change in a single crate selects that crate and its reverse dependencies,
/// never the whole workspace.
#[test]
fn crate_change_maps_to_rdeps_of_that_crate() {
    let graph = build_graph(false).expect("cargo metadata");
    let packages = compute_packages(&graph, "crates/email_validator/src/lib.rs\n").unwrap();
    assert_ne!(packages, "none");
    assert_ne!(packages, "all");
    let set: BTreeSet<&str> = packages.split_whitespace().collect();
    assert!(
        set.contains("email_validator"),
        "changed crate must be selected: {packages}"
    );
}

/// Top-level files that belong to no package — a JSON at the repo root, a
/// README, a deleted misc file — must not select the full suite.
#[test]
fn unmapped_files_alone_yield_none() {
    let graph = build_graph(false).expect("cargo metadata");
    let packages = compute_packages(
        &graph,
        "random.json\npackage.json\ndocs/README.md\njustfile\n",
    )
    .unwrap();
    assert_eq!(packages, "none");
}

/// Shared assets embedded into crates from outside their directories select
/// their consumers (and those consumers' reverse deps).
#[test]
fn embedded_assets_select_their_consumers() {
    let graph = build_graph(false).expect("cargo metadata");

    let packages = compute_packages(&graph, "static_assets/schema.graphql\n").unwrap();
    let set: BTreeSet<&str> = packages.split_whitespace().collect();
    for expected in [
        "cache-core",
        "complete_graph",
        "documents",
        "seed_cli",
        "xtask_workflows",
    ] {
        assert!(
            set.contains(expected),
            "embedded asset consumers must include {expected}: {packages}"
        );
    }

    let mixed = compute_packages(
        &graph,
        "crates/email_validator/src/lib.rs\nstatic_assets/markdown-golden.1.bin\n",
    )
    .unwrap();
    let mixed_set: BTreeSet<&str> = mixed.split_whitespace().collect();
    assert!(mixed_set.contains("email_validator"));
    assert!(mixed_set.contains("documents"));
}

/// Drift check: every workspace package whose Rust sources mention an
/// [`EMBEDDED_ASSET_PACKAGES`] path prefix must be listed in the table (and
/// vice versa), so new compile-time embeds of shared assets never silently
/// escape the CI test filter. The scan is textual, so a doc-comment mention
/// counts; listing such a package merely over-selects, which is the safe
/// direction.
#[test]
fn embedded_asset_packages_match_source_references() {
    let graph = build_graph(false).expect("cargo metadata");
    let workspace = graph.workspace();

    let packages: Vec<(PathBuf, String)> = workspace
        .iter()
        .map(|package| {
            let dir = package.manifest_path().parent().expect("manifest parent");
            (PathBuf::from(dir.as_std_path()), package.name().to_owned())
        })
        .collect();

    let mut rust_files = BTreeSet::new();
    for (dir, _) in &packages {
        collect_rust_files(dir, &mut rust_files);
    }

    for (prefix, expected) in EMBEDDED_ASSET_PACKAGES {
        let mut found = BTreeSet::new();
        for file in &rust_files {
            let content = std::fs::read_to_string(file).unwrap_or_default();
            if !content.contains(prefix) {
                continue;
            }
            // Attribute the file to its deepest containing package, mirroring
            // compute_packages, so nested workspaces (tooling/xtask/crates/*)
            // don't credit the parent package.
            let owner = packages
                .iter()
                .filter(|(dir, _)| file.starts_with(dir))
                .max_by_key(|(dir, _)| dir.components().count())
                .map(|(_, name)| name.clone())
                .expect("rust file collected from a package dir");
            // This crate's own sources name the prefixes it maps.
            if owner == env!("CARGO_PKG_NAME") {
                continue;
            }
            found.insert(owner);
        }

        let expected: BTreeSet<String> = expected.iter().map(|name| (*name).to_owned()).collect();
        assert_eq!(
            found, expected,
            "EMBEDDED_ASSET_PACKAGES entry for `{prefix}` is out of sync with the \
             packages whose Rust sources reference it; update the table in main.rs"
        );
    }
}

/// Recursively collect `.rs` files under `dir`, skipping hidden and build
/// output directories.
fn collect_rust_files(dir: &Path, out: &mut BTreeSet<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if name.starts_with('.') || name == "target" || name == "node_modules" {
                continue;
            }
            collect_rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.insert(path);
        }
    }
}
