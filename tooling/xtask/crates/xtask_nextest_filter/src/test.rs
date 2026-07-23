use super::*;

/// A change in a single crate selects only that crate's reverse dependencies.
#[test]
fn crate_change_maps_to_rdeps_of_that_crate() {
    let graph = build_graph(false).expect("cargo metadata");
    let filter = compute_filter(&graph, "crates/email_validator/src/lib.rs\n").unwrap();
    assert_eq!(filter, "rdeps(=email_validator)");
}

/// Changed files inside the workspace that belong to no package (and are not
/// embedded assets) contribute nothing, leaving the filter empty so CI falls
/// back to the full suite.
#[test]
fn unmapped_files_alone_yield_empty_filter() {
    let graph = build_graph(false).expect("cargo metadata");
    let filter = compute_filter(&graph, "docs/README.md\njustfile\n").unwrap();
    assert_eq!(filter, "");
}

/// Shared assets embedded into crates from outside their directories select
/// their consumers, including when the change list also contains ordinary
/// package files (previously the asset change was silently dropped).
#[test]
fn embedded_assets_select_their_consumers() {
    let graph = build_graph(false).expect("cargo metadata");

    let filter = compute_filter(&graph, "static_assets/schema.graphql\n").unwrap();
    assert_eq!(
        filter,
        "rdeps(=cache-core)|rdeps(=complete_graph)|rdeps(=documents)|rdeps(=seed_cli)|rdeps(=xtask_workflows)"
    );

    let mixed = compute_filter(
        &graph,
        "crates/email_validator/src/lib.rs\nstatic_assets/markdown-golden.1.bin\n",
    )
    .unwrap();
    assert_eq!(
        mixed,
        "rdeps(=cache-core)|rdeps(=complete_graph)|rdeps(=documents)|rdeps(=email_validator)|rdeps(=seed_cli)|rdeps(=xtask_workflows)"
    );
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
            // compute_filter, so nested workspaces (tooling/xtask/crates/*)
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
