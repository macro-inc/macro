use guppy::graph::{PackageGraph, PackageMetadata};

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
