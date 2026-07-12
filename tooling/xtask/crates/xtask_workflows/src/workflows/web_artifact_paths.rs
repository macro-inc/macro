//! Repository inputs that can change the built web application artifact.

use xtask_paths::RepoGlob;

/// Shared by web checks, preview builds, and development deployments so a
/// cache-WASM or shared-package change cannot be tested without being deployed
/// (or deployed without being tested).
pub const WEB_ARTIFACT_PATHS: &[RepoGlob<'static>] = &[
    RepoGlob::new("package.json"),
    RepoGlob::new("bun.lock"),
    RepoGlob::new("apps/web/**"),
    RepoGlob::new("packages/**"),
    RepoGlob::new("crates/client/cache-core/**"),
    RepoGlob::new("crates/client/cache-idb/**"),
    RepoGlob::new("crates/client/cache-wasm/**"),
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

/// Render the shared paths for `diff-checker-action`'s space-delimited input.
pub fn diff_checker_list() -> String {
    WEB_ARTIFACT_PATHS
        .iter()
        .map(|path| format!("./{}", path.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}
