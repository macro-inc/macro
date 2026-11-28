//! Repository inputs that can change the built web application artifact.

use xtask_paths::RepoGlob;

/// Shared by web checks and preview builds so a cache-WASM, fold-WASM,
/// SQL-WASM, natural-time-WASM, or shared-package change cannot be tested
/// without being built (or built without being tested). The push-to-main dev
/// deploy is not path-gated at all — see [`crate::workflows::deploy_on_push`]
/// for why.
pub const WEB_ARTIFACT_PATHS: &[RepoGlob<'static>] = &[
    RepoGlob::new("package.json"),
    RepoGlob::new("bun.lock"),
    RepoGlob::new("apps/web/**"),
    RepoGlob::new("packages/**"),
    RepoGlob::new("tooling/icons/**"),
    RepoGlob::new("crates/folds/agent_fold/**"),
    RepoGlob::new("crates/agent_runtime_protocol/**"),
    RepoGlob::new("crates/client/cache-core/**"),
    RepoGlob::new("crates/client/cache-schema/**"),
    RepoGlob::new("crates/client/cache-turso/**"),
    RepoGlob::new("crates/client/cache-wasm/**"),
    RepoGlob::new("crates/client/turso-opfs/**"),
    RepoGlob::new("crates/database_sql/**"),
    RepoGlob::new("crates/filter_ast/**"),
    RepoGlob::new("crates/item_filters/**"),
    RepoGlob::new("crates/natural_time/**"),
    RepoGlob::new("crates/password_import/**"),
    RepoGlob::new("crates/password_import_wasm/**"),
    // The local crates the ones above compile, which
    // `paths_cover_every_local_crate_the_listed_crates_build` keeps complete.
    RepoGlob::new("crates/bot_id/**"),
    RepoGlob::new("crates/cowlike/**"),
    RepoGlob::new("crates/document_sub_type/**"),
    RepoGlob::new("crates/dynamic_ui/**"),
    RepoGlob::new("crates/graphql_soup_filter_input/**"),
    RepoGlob::new("crates/item_filter_index/**"),
    RepoGlob::new("crates/macro_user_id/**"),
    RepoGlob::new("crates/macro_uuid/**"),
    RepoGlob::new("crates/maybe_send/**"),
    RepoGlob::new("crates/model_file_type/**"),
    RepoGlob::new("crates/model_owner/**"),
    RepoGlob::new("crates/models_databases/**"),
    RepoGlob::new("crates/non_empty/**"),
    RepoGlob::new("crates/notification_state/**"),
    RepoGlob::new("crates/predicate_index/**"),
    RepoGlob::new("crates/soup_filter_cache_adapter/**"),
    RepoGlob::new("crates/soup_filter_projection/**"),
    RepoGlob::new("crates/subsequence_match/**"),
    RepoGlob::new("static_assets/schema.graphql"),
    RepoGlob::new("Cargo.toml"),
    RepoGlob::new("Cargo.lock"),
    RepoGlob::new("rust-toolchain.toml"),
    // The WASM builds' target flags.
    RepoGlob::new(".cargo/config.toml"),
];

/// Render the shared paths as a YAML sequence at the requested indentation.
pub fn yaml_list(indent: &str) -> String {
    WEB_ARTIFACT_PATHS
        .iter()
        .map(|path| format!("{indent}- '{}'\n", path.as_str()))
        .collect()
}

#[cfg(test)]
mod test;
