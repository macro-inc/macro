use super::*;

fn changed_files(paths: &[&str]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

/// Path-only selection on the real workspace with the repository's rules.
fn select_in_repo(graph: &PackageGraph, paths: &[&str]) -> PackageSelection {
    select_by_paths(graph, &changed_files(paths), &repository_rules().unwrap()).unwrap()
}

fn selected_packages(selection: &PackageSelection) -> &BTreeSet<String> {
    selection
        .packages()
        .unwrap_or_else(|| panic!("expected targeted packages, got {selection:?}"))
}

/// The CLI prints `all` / `none` / space-separated names; bash switches on those
/// tokens and must not see an empty string for an unmapped change.
#[test]
fn display_is_the_cli_seam() {
    assert_eq!(PackageSelection::All.to_string(), "all");
    assert_eq!(PackageSelection::None.to_string(), "none");
    assert_eq!(
        PackageSelection::Packages(BTreeSet::from([
            "email_validator".to_owned(),
            "webhook".to_owned(),
        ]))
        .to_string(),
        "email_validator webhook"
    );
}

/// Path-only changes go through [`select_by_paths`], which skips
/// determinator's per-member build simulation (seconds of feature resolution
/// per call). [`compute_packages`] is covered on small synthetic workspaces
/// below, where that simulation is cheap.
///
/// A change in a single crate selects that crate and its reverse dependencies,
/// never the whole workspace.
#[test]
fn crate_change_maps_to_rdeps_of_that_crate() {
    let graph = build_graph(false).expect("cargo metadata");
    let selection = select_in_repo(&graph, &["crates/email_validator/src/lib.rs"]);
    assert_ne!(selection, PackageSelection::None);
    assert_ne!(selection, PackageSelection::All);
    assert!(
        selected_packages(&selection).contains("email_validator"),
        "changed crate must be selected: {selection:?}"
    );
}

/// Top-level files that belong to no package — a JSON at the repo root, a
/// README, a deleted misc file — must not select the full suite.
#[test]
fn unmapped_files_alone_yield_none() {
    let graph = build_graph(false).expect("cargo metadata");
    let selection = select_in_repo(
        &graph,
        &["random.json", "package.json", "docs/README.md", "justfile"],
    );
    assert_eq!(selection, PackageSelection::None);
}

/// Package-local metadata files still select their package because some are
/// compile-time inputs (for example, webhook embeds its README).
#[test]
fn package_readme_selects_its_package() {
    let graph = build_graph(false).expect("cargo metadata");
    let selection = select_in_repo(&graph, &["crates/webhook/README.md"]);
    assert!(
        selected_packages(&selection).contains("webhook"),
        "package README must select its owner: {selection:?}"
    );
}

/// Shared assets embedded into crates from outside their directories select
/// their consumers (and those consumers' reverse deps).
#[test]
fn embedded_assets_select_their_consumers() {
    let graph = build_graph(false).expect("cargo metadata");

    let selection = select_in_repo(&graph, &["static_assets/schema.graphql"]);
    let set = selected_packages(&selection);
    for expected in [
        "cache-core",
        "collab_surface",
        "complete_graph",
        "documents",
        "seed_cli",
        "xtask_workflows",
    ] {
        assert!(
            set.contains(expected),
            "embedded asset consumers must include {expected}: {selection:?}"
        );
    }

    let mixed = select_in_repo(
        &graph,
        &[
            "crates/email_validator/src/lib.rs",
            "static_assets/markdown-golden.1.bin",
        ],
    );
    let mixed_set = selected_packages(&mixed);
    assert!(mixed_set.contains("email_validator"));
    assert!(mixed_set.contains("documents"));
    assert!(mixed_set.contains("collab_surface"));
}

/// Drift check: every workspace package whose Rust sources mention the shared
/// asset path must be listed in the determinator rule (and vice versa). The
/// scan is textual, so a doc-comment mention merely over-selects safely.
#[test]
fn embedded_asset_packages_match_source_references() {
    let graph = build_graph(false).expect("cargo metadata");
    let workspace = graph.workspace();
    let prefix = "static_assets";

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

    let mut found = BTreeSet::new();
    for file in &rust_files {
        let content = std::fs::read_to_string(file).unwrap_or_default();
        if !content.contains(prefix) {
            continue;
        }
        // Attribute the file to its deepest containing package, mirroring
        // determinator's nearest-package behavior for nested xtask crates.
        let owner = packages
            .iter()
            .filter(|(dir, _)| file.starts_with(dir))
            .max_by_key(|(dir, _)| dir.components().count())
            .map(|(_, name)| name.clone())
            .expect("rust file collected from a package dir");
        if owner != env!("CARGO_PKG_NAME") {
            found.insert(owner);
        }
    }

    let rules = DeterminatorRules::parse(DETERMINATOR_RULES).expect("determinator rules");
    let mut determinator = Determinator::new(&graph, &graph);
    determinator.set_rules(&rules).expect("set rules");
    let mut configured = BTreeSet::new();
    determinator.match_path("static_assets/drift-check", |id| {
        configured.insert(
            graph
                .metadata(id)
                .expect("package metadata")
                .name()
                .to_owned(),
        );
    });

    assert_eq!(
        found, configured,
        "determinator rule for `{prefix}` is out of sync with packages whose Rust sources \
         reference it; update determinator.toml"
    );
}

const BASE_MANIFEST: &str = r#"
[workspace]
resolver = "2"
members = ["crates/a", "crates/b"]

[workspace.dependencies]
anyhow = "1.0.100"
serde = { version = "1.0.214", features = ["derive"] }

[profile.fig-engine-wasm]
inherits = "release"
lto = "fat"
"#;

fn manifest_forces_all(new: &str) -> bool {
    root_manifest_change_forces_all(BASE_MANIFEST, new).expect("valid manifests")
}

/// Adding or removing a member is a package-graph change determinator scopes
/// to the new package (or to the manifests that depended on a removed one).
#[test]
fn members_only_change_defers_to_determinator() {
    let new = BASE_MANIFEST.replace(
        r#"members = ["crates/a", "crates/b"]"#,
        r#"members = ["crates/a", "crates/b", "crates/c"]"#,
    );
    assert_ne!(new, BASE_MANIFEST);
    assert!(!manifest_forces_all(&new));
}

/// Workspace dependency specs reach members through inheritance, so the
/// graph diff selects exactly the members whose resolved deps changed.
#[test]
fn workspace_dependencies_only_change_defers_to_determinator() {
    let new = BASE_MANIFEST
        .replace(r#"anyhow = "1.0.100""#, r#"anyhow = "1.0.101""#)
        .replace(r#"features = ["derive"]"#, r#"features = ["derive", "rc"]"#)
        .replace(
            "[workspace.dependencies]\n",
            "[workspace.dependencies]\nhex = \"0.4.3\"\n",
        );
    assert_ne!(new, BASE_MANIFEST);
    assert!(!manifest_forces_all(&new));
}

/// Comments and formatting are not semantic edits.
#[test]
fn comment_and_formatting_change_is_not_a_change() {
    let new = BASE_MANIFEST.replace(
        "[profile.fig-engine-wasm]",
        "# Browser build for the fig engine.\n[profile.fig-engine-wasm]",
    );
    assert!(!manifest_forces_all(&new));
}

/// Profiles change compile flags for every package without touching the graph.
#[test]
fn profile_change_forces_all() {
    assert!(manifest_forces_all(
        &BASE_MANIFEST.replace(r#"lto = "fat""#, r#"lto = "thin""#)
    ));
    let added = format!("{BASE_MANIFEST}\n[profile.dev]\ndebug = \"limited\"\n");
    assert!(manifest_forces_all(&added));
}

/// Workspace lints change every member's clippy/rustc output.
#[test]
fn workspace_lints_change_forces_all() {
    let new = format!("{BASE_MANIFEST}\n[workspace.lints.rust]\nunsafe_code = \"forbid\"\n");
    assert!(manifest_forces_all(&new));
}

/// Other workspace-level settings are invisible to the graph diff as well.
#[test]
fn resolver_patch_and_package_changes_force_all() {
    assert!(manifest_forces_all(
        &BASE_MANIFEST.replace(r#"resolver = "2""#, r#"resolver = "3""#)
    ));
    assert!(manifest_forces_all(&format!(
        "{BASE_MANIFEST}\n[patch.crates-io]\nserde = {{ path = \"vendor/serde\" }}\n"
    )));
    assert!(manifest_forces_all(&format!(
        "{BASE_MANIFEST}\n[workspace.package]\nedition = \"2024\"\n"
    )));
}

/// A members edit combined with anything else still forces the full suite.
#[test]
fn mixed_members_and_profile_change_forces_all() {
    let new = BASE_MANIFEST
        .replace(
            r#"members = ["crates/a", "crates/b"]"#,
            r#"members = ["crates/a"]"#,
        )
        .replace(r#"lto = "fat""#, "lto = false");
    assert!(manifest_forces_all(&new));
}

/// The real root manifest parses, and comparing it with itself is a no-op.
#[test]
fn repository_root_manifest_is_classified() {
    let manifest = read_manifest(&xtask_paths::workspace_root()).expect("root manifest");
    assert!(!root_manifest_change_forces_all(&manifest, &manifest).unwrap());
}

/// A tiny two-crate workspace (`b` depends on `a` through
/// `workspace.dependencies`) written to a temp dir, with optional overrides.
struct SyntheticWorkspace {
    dir: TempDir,
}

impl SyntheticWorkspace {
    /// `a` plus `others`, each depending on `a` through
    /// `workspace.dependencies` with `a_features` enabled.
    fn new(members: &[&str], a_features: &str) -> Self {
        let manifests: Vec<(&str, &str)> = members
            .iter()
            .map(|member| {
                let deps = if *member == "a" {
                    "[features]\nextra = []\n"
                } else {
                    "[dependencies]\na = { workspace = true }\n"
                };
                (*member, deps)
            })
            .collect();
        Self::with_members(
            &manifests,
            &format!("a = {{ path = \"a\", features = [{a_features}] }}\n"),
        )
    }

    /// Members given as `(name, manifest body after [package])`.
    fn with_members(members: &[(&str, &str)], workspace_dependencies: &str) -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let write = |path: &str, content: &str| {
            let path = dir.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        };
        let quoted: Vec<String> = members
            .iter()
            .map(|(name, _)| format!("{name:?}"))
            .collect();
        write(
            "Cargo.toml",
            &format!(
                "[workspace]\nresolver = \"2\"\nmembers = [{}]\n\n[workspace.dependencies]\n\
                 {workspace_dependencies}",
                quoted.join(", ")
            ),
        );
        for (name, body) in members {
            write(
                &format!("{name}/Cargo.toml"),
                &format!(
                    "[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n{body}"
                ),
            );
            write(&format!("{name}/src/lib.rs"), "");
        }
        Self { dir }
    }

    fn graph(&self) -> PackageGraph {
        build_graph_at(self.dir.path(), false).expect("cargo metadata for synthetic workspace")
    }
}

/// The repository's path rules name real packages, so the synthetic
/// workspaces run determinator without them.
fn no_path_rules() -> DeterminatorRules {
    DeterminatorRules::parse("use-default-rules = false").expect("empty rules")
}

/// A new member reaches determinator as a new package; nothing that existed
/// before is rebuilt.
#[test]
fn graph_diff_scopes_a_new_member_to_itself() {
    let old = SyntheticWorkspace::new(&["a", "b"], "");
    let new = SyntheticWorkspace::new(&["a", "b", "c"], "");
    let selection = compute_packages(
        &old.graph(),
        &new.graph(),
        &changed_files(&["Cargo.toml", "c/Cargo.toml", "c/src/lib.rs"]),
        &no_path_rules(),
    )
    .unwrap();
    assert_eq!(
        selection,
        PackageSelection::Packages(BTreeSet::from(["c".to_owned()]))
    );
}

/// A feature added in `workspace.dependencies` shows up in the simulated
/// build of the member that inherits it, so the root-manifest edit selects
/// that member without anyone touching its own files.
#[test]
fn graph_diff_scopes_a_workspace_dependency_change_to_inheritors() {
    let old = SyntheticWorkspace::new(&["a", "b", "c"], "");
    let new = SyntheticWorkspace::new(&["a", "b", "c"], "\"extra\"");
    let selection = compute_packages(
        &old.graph(),
        &new.graph(),
        &changed_files(&["Cargo.toml"]),
        &no_path_rules(),
    )
    .unwrap();
    assert_eq!(
        selection,
        PackageSelection::Packages(BTreeSet::from(["b".to_owned(), "c".to_owned()]))
    );
}

/// The fast path agrees with determinator on what a build contains: a
/// dev-dependency reaches only its declarer's tests (`b` dev-depends on `a`,
/// `c` uses `b`'s library), normal dependencies are transitive (`e` → `d` →
/// `a`), and an optional dependency nobody enables builds nothing (`g` uses
/// `h` without the feature that pulls in `a`).
#[test]
fn fast_path_matches_determinator_on_build_edges() {
    let workspace = SyntheticWorkspace::with_members(
        &[
            ("a", ""),
            ("b", "[dev-dependencies]\na = { path = \"../a\" }\n"),
            ("c", "[dependencies]\nb = { path = \"../b\" }\n"),
            ("d", "[dependencies]\na = { path = \"../a\" }\n"),
            ("e", "[dependencies]\nd = { path = \"../d\" }\n"),
            ("f", ""),
            ("g", "[dependencies]\nh = { path = \"../h\" }\n"),
            (
                "h",
                "[dependencies]\na = { path = \"../a\", optional = true }\n\n\
                 [features]\nwith_a = [\"dep:a\"]\n",
            ),
        ],
        "",
    );
    let graph = workspace.graph();
    let expected =
        PackageSelection::Packages(BTreeSet::from(["a", "b", "d", "e", "h"].map(str::to_owned)));
    let changed = changed_files(&["a/src/lib.rs"]);
    assert_eq!(
        select_by_paths(&graph, &changed, &no_path_rules()).unwrap(),
        expected
    );
    assert_eq!(
        compute_packages(&graph, &graph, &changed, &no_path_rules()).unwrap(),
        expected
    );
}

/// Only manifests and lockfiles can change `cargo metadata`; everything else
/// takes the path-only fast path.
#[test]
fn only_manifests_and_lockfiles_need_the_graph_diff() {
    for path in [
        "Cargo.toml",
        "Cargo.lock",
        "crates/email_validator/Cargo.toml",
    ] {
        assert!(changes_cargo_graph(Path::new(path)), "{path}");
    }
    for path in [
        "crates/email_validator/src/lib.rs",
        "Cargo.toml.orig",
        "docs/Cargo.md",
        "static_assets/schema.graphql",
    ] {
        assert!(!changes_cargo_graph(Path::new(path)), "{path}");
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
