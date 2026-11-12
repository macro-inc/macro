use guppy::graph::{PackageGraph, PackageMetadata};
use guppy::platform::PlatformStatus;

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

/// The `cfg` keys target-spec evaluates from the target triple alone.
/// `wasm_closure` resolves a bare triple, so a workspace dependency gated on
/// anything else (a `--cfg` flag from `.cargo/config.toml`, a target feature)
/// may evaluate to off for wasm32 although cargo compiles it.
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

#[test]
fn workspace_links_a_wasm_package_can_reach_gate_only_on_the_triple() {
    let graph = graph();
    let mut reachable = std::collections::BTreeSet::new();
    for name in WASM_PACKAGES {
        reachable.extend(closure(&graph, member(&graph, name)).expect("closure"));
    }

    let mut unsupported = Vec::new();
    for package in graph.workspace().iter() {
        let dir = package
            .manifest_path()
            .parent()
            .and_then(|dir| dir.strip_prefix(graph.workspace().root()).ok())
            .expect("crate dir inside the workspace");
        if !reachable.contains(dir.as_str()) {
            continue;
        }
        for link in package.direct_links() {
            if !link.to().in_workspace() {
                continue;
            }
            for req in [link.normal(), link.build()] {
                let status = req.status();
                for platform in [status.required_status(), status.optional_status()] {
                    let PlatformStatus::PlatformDependent { eval } = platform else {
                        continue;
                    };
                    for spec in eval.target_specs() {
                        let spec = spec.to_string();
                        let unknown: Vec<String> = cfg_identifiers(&spec)
                            .into_iter()
                            .filter(|word| !TRIPLE_CFG_KEYS.contains(&word.as_str()))
                            .collect();
                        // A plain target triple has a `-` outside quotes;
                        // cfg identifiers can't.
                        let triple = !spec.contains('"') && spec.contains('-');
                        if !triple && !unknown.is_empty() {
                            unsupported.push(format!(
                                "{} -> {}: {spec}",
                                package.name(),
                                link.to().name()
                            ));
                        }
                    }
                }
            }
        }
    }
    assert!(
        unsupported.is_empty(),
        "wasm_closure can't evaluate these for wasm32; resolve them with the flags cargo passes before adding the key to TRIPLE_CFG_KEYS: {unsupported:#?}"
    );
}
