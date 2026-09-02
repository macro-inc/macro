//! Repository inputs that can change the built web application artifact.

use xtask_paths::RepoGlob;

/// Shared by web checks and preview builds so a cache-WASM or shared-package
/// change cannot be tested without being built (or built without being
/// tested). The push-to-main dev deploy is not path-gated at all — see
/// [`crate::workflows::deploy_on_push`] for why.
pub const WEB_ARTIFACT_PATHS: &[RepoGlob<'static>] = &[
    RepoGlob::new("package.json"),
    RepoGlob::new("bun.lock"),
    RepoGlob::new("apps/web/**"),
    RepoGlob::new("packages/**"),
    RepoGlob::new("crates/client/cache-core/**"),
    RepoGlob::new("crates/client/cache-turso/**"),
    RepoGlob::new("crates/client/cache-wasm/**"),
    RepoGlob::new("crates/client/turso-opfs/**"),
    RepoGlob::new("static_assets/schema.graphql"),
    RepoGlob::new("Cargo.toml"),
    RepoGlob::new("Cargo.lock"),
    RepoGlob::new("rust-toolchain.toml"),
];

/// Render the shared paths as a YAML sequence at the requested indentation.
pub fn yaml_list(indent: &str) -> String {
    WEB_ARTIFACT_PATHS
        .iter()
        .map(|path| format!("{indent}- '{}'\n", path.as_str()))
        .collect()
}
