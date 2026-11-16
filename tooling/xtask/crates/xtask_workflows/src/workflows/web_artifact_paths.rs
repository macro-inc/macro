//! Repository inputs that can change the built web application artifact.

use std::collections::BTreeSet;

use xtask_paths::RepoGlob;

/// Shared by web checks and preview builds so a wasm-module or shared-package
/// change cannot be tested without being built (or built without being
/// tested). The push-to-main dev deploy is not path-gated at all — see
/// [`crate::workflows::deploy_on_push`] for why. The crates the browser wasm
/// modules compile come from [`wasm_crate_dirs`].
const WEB_ARTIFACT_PATHS: &[RepoGlob<'static>] = &[
    RepoGlob::new("package.json"),
    RepoGlob::new("bun.lock"),
    RepoGlob::new("apps/web/**"),
    RepoGlob::new("packages/**"),
    RepoGlob::new("tooling/icons/**"),
    RepoGlob::new("static_assets/schema.graphql"),
    RepoGlob::new("Cargo.toml"),
    RepoGlob::new("Cargo.lock"),
    RepoGlob::new("rust-toolchain.toml"),
];

/// Every workspace crate a module of `apps/web/wasm-modules.json` compiles for
/// wasm32: the `wasm_closures` that `cargo x deps` writes from that manifest.
pub fn wasm_crate_dirs() -> BTreeSet<String> {
    let path = xtask_paths::repo_root().join(".github/workspace-dep-closures.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
    let closures: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("parsing {}: {error}", path.display()));
    let wasm_closures = closures["wasm_closures"]
        .as_object()
        .unwrap_or_else(|| panic!("{} has no wasm_closures", path.display()));

    wasm_closures
        .values()
        .flat_map(|dirs| dirs.as_array().into_iter().flatten())
        .map(|dir| {
            dir.as_str()
                .unwrap_or_else(|| panic!("{}: non-string wasm closure dir", path.display()))
                .to_owned()
        })
        .collect()
}

/// Render the shared paths as a YAML sequence at the requested indentation.
pub fn yaml_list(indent: &str) -> String {
    let fixed = WEB_ARTIFACT_PATHS
        .iter()
        .map(|path| path.as_str().to_owned());
    let crates = wasm_crate_dirs().into_iter().map(|dir| format!("{dir}/**"));
    fixed
        .chain(crates)
        .map(|path| format!("{indent}- '{path}'\n"))
        .collect()
}
