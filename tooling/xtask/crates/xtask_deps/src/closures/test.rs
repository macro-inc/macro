use guppy::graph::{DependencyReq, PackageGraph, PackageMetadata};
use guppy::platform::PlatformStatus;
use std::collections::BTreeSet;

use super::{WASM_PACKAGES, closure, wasm_closure};

fn graph() -> PackageGraph {
    xtask_graph::build_graph(false).expect("cargo metadata for the workspace")
}

fn member<'g>(graph: &'g PackageGraph, name: &str) -> PackageMetadata<'g> {
    graph
        .workspace()
        .member_by_name(name)
        .unwrap_or_else(|_| panic!("{name} is not a workspace member"))
}

#[test]
fn wasm_closures_hold_their_package_and_stay_inside_the_plain_closures() {
    let graph = graph();
    for name in WASM_PACKAGES {
        let package = member(&graph, name);
        let wasm = wasm_closure(&graph, name).expect("wasm closure");
        let plain = closure(&graph, package).expect("closure");
        let own_dir = package
            .manifest_path()
            .parent()
            .and_then(|dir| dir.strip_prefix(graph.workspace().root()).ok())
            .expect("crate dir inside the workspace");
        assert!(wasm.contains(own_dir.as_str()), "{name} lacks {own_dir}");
        assert!(
            wasm.is_subset(&plain),
            "{name}: {:?} outside the plain closure",
            wasm.difference(&plain).collect::<Vec<_>>()
        );
    }
}

/// The cache WASM's plain closure follows its server-only links into most of the
/// backend; a wasm32 build compiles a small part of it.
#[test]
fn wasm_closure_drops_crates_a_wasm32_build_never_compiles() {
    let graph = graph();
    let wasm = wasm_closure(&graph, "cache-wasm").expect("wasm closure");
    let plain = closure(&graph, member(&graph, "cache-wasm")).expect("closure");
    assert!(
        wasm.len() * 2 < plain.len(),
        "{} of {} dirs",
        wasm.len(),
        plain.len()
    );
}

/// The cache WASM reaches its storage crate only through a
/// `cfg(target_arch = "wasm32")` dependency, so a closure resolved for any other
/// target would leave it out.
#[test]
fn wasm_closure_follows_wasm32_only_links() {
    let graph = graph();
    let wasm = wasm_closure(&graph, "cache-wasm").expect("wasm closure");
    assert!(wasm.contains("crates/client/cache-turso"), "{wasm:?}");
}

/// The `cfg` keys target-spec decides from the target triple alone.
/// `wasm_closure` resolves a bare triple, so a key outside this list, such as a
/// `--cfg` flag from `.cargo/config.toml`, evaluates to off for wasm32 although
/// cargo turns it on. (A target feature evaluates to unknown, which CargoSet
/// keeps; the guard flags it too, which at worst asks for a needless look.)
const TRIPLE_CFG_KEYS: &[&str] = &[
    "all",
    "any",
    "not",
    "target_abi",
    "target_arch",
    "target_endian",
    "target_env",
    "target_family",
    "target_has_atomic",
    "target_os",
    "target_pointer_width",
    "target_vendor",
    "unix",
    "windows",
];

/// The identifiers of a cfg expression (as target-spec prints it, without the
/// `cfg(...)` around it), leaving out its quoted values.
fn cfg_identifiers(expression: &str) -> Vec<String> {
    let unquoted: String = expression
        .split('"')
        .step_by(2)
        .collect::<Vec<_>>()
        .join(" ");
    unquoted
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|word| !word.is_empty() && !word.starts_with(|c: char| c.is_ascii_digit()))
        .map(str::to_owned)
        .collect()
}

#[test]
fn cfg_identifiers_skip_quoted_values() {
    assert_eq!(
        cfg_identifiers(r#"all(target_arch = "wasm32", not(getrandom_backend = "x-y"))"#),
        ["all", "target_arch", "not", "getrandom_backend"]
    );
}

/// The target specs that gate a dependency or any of the features it turns on
/// in the dependency.
fn gating_specs(req: &DependencyReq<'_>) -> Vec<String> {
    let statuses = [req.status(), req.default_features()]
        .into_iter()
        .chain(req.features().map(|feature| req.feature_status(feature)));
    let mut specs = Vec::new();
    for status in statuses {
        for platform in [status.required_status(), status.optional_status()] {
            if let PlatformStatus::PlatformDependent { eval } = platform {
                specs.extend(eval.target_specs().iter().map(ToString::to_string));
            }
        }
    }
    specs
}

/// Whether target-spec can decide `spec` for wasm32 from the triple. A plain
/// target triple has a `-` outside quotes; cfg identifiers can't.
fn decided_by_the_triple(spec: &str) -> bool {
    let triple = !spec.contains('"') && spec.contains('-');
    triple
        || cfg_identifiers(spec)
            .iter()
            .all(|word| TRIPLE_CFG_KEYS.contains(&word.as_str()))
}

/// The links into workspace crates, from the crates in `scope` (directories),
/// that a gate target-spec can't decide for wasm32 turns on or widens, sorted.
fn undecided_links(graph: &PackageGraph, scope: &BTreeSet<String>) -> Vec<String> {
    let mut undecided = BTreeSet::new();
    for package in graph.workspace().iter() {
        let dir = package
            .manifest_path()
            .parent()
            .and_then(|dir| dir.strip_prefix(graph.workspace().root()).ok())
            .expect("crate dir inside the workspace");
        if !scope.contains(dir.as_str()) {
            continue;
        }
        for link in package.direct_links() {
            if !link.to().in_workspace() {
                continue;
            }
            for req in [link.normal(), link.build()] {
                for spec in gating_specs(&req) {
                    if !decided_by_the_triple(&spec) {
                        undecided.insert(format!(
                            "{} -> {}: {spec}",
                            package.name(),
                            link.to().name()
                        ));
                    }
                }
            }
        }
    }
    undecided.into_iter().collect()
}

#[test]
fn workspace_links_a_wasm_package_can_reach_gate_only_on_the_triple() {
    let graph = graph();
    let mut reachable = BTreeSet::new();
    for name in WASM_PACKAGES {
        reachable.extend(closure(&graph, member(&graph, name)).expect("closure"));
    }
    let undecided = undecided_links(&graph, &reachable);
    assert!(
        undecided.is_empty(),
        "wasm_closure can't decide these for wasm32; resolve them with the flags cargo passes before adding the key to TRIPLE_CFG_KEYS: {undecided:#?}"
    );
}

/// A dependency that is always on but whose features a `--cfg` flag widens:
/// the gate is on the features, not on the link.
#[test]
fn undecided_feature_gates_are_found() {
    let root = std::env::temp_dir().join(format!("xtask-deps-gates-{}", std::process::id()));
    let manifests = [
        (
            "",
            "[workspace]\nresolver = \"2\"\nmembers = [\"pkg\", \"a\", \"b\", \"g\", \"k\"]\n",
        ),
        (
            "pkg",
            "[dependencies]\na = { path = \"../a\" }\ng = { path = \"../g\", default-features = false }\n\
             [target.'cfg(getrandom_backend = \"wasm_js\")'.dependencies]\n\
             a = { path = \"../a\", features = [\"f\"] }\ng = { path = \"../g\" }\n",
        ),
        (
            "a",
            "[features]\nf = [\"dep:b\"]\n[dependencies]\nb = { path = \"../b\", optional = true }\n",
        ),
        ("b", ""),
        (
            "g",
            "[features]\ndefault = [\"dep:k\"]\n[dependencies]\nk = { path = \"../k\", optional = true }\n",
        ),
        ("k", ""),
    ];
    for (dir, body) in manifests {
        let crate_dir = root.join(dir);
        std::fs::create_dir_all(crate_dir.join("src")).expect("crate dir");
        let manifest = if dir.is_empty() {
            body.to_owned()
        } else {
            std::fs::write(crate_dir.join("src/lib.rs"), "").expect("lib.rs");
            format!("[package]\nname = \"{dir}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n{body}")
        };
        std::fs::write(crate_dir.join("Cargo.toml"), manifest).expect("manifest");
    }
    let graph = xtask_graph::build_graph_at(&root, false);
    std::fs::remove_dir_all(&root).expect("remove the fixture");
    let graph = graph.expect("cargo metadata for the fixture");

    let undecided = undecided_links(&graph, &BTreeSet::from(["pkg".to_owned()]));
    assert_eq!(
        undecided,
        [
            r#"pkg -> a: getrandom_backend = "wasm_js""#,
            r#"pkg -> g: getrandom_backend = "wasm_js""#,
        ],
    );
}
