//! Repository inputs that can change the built web application artifact.

use xtask_paths::RepoGlob;

/// Shared by web checks and preview builds so a change to a WASM package the
/// app ships (cache, fold, SQL, natural time, password import, and the Office,
/// Figma, Photoshop and AI engines) or to a shared package cannot be tested
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
    RepoGlob::new("crates/ai_engine/**"),
    RepoGlob::new("crates/docx_engine/**"),
    RepoGlob::new("crates/fig_engine/**"),
    RepoGlob::new("crates/pptx_engine/**"),
    RepoGlob::new("crates/psd_engine/**"),
    // The other workspace crates those packages compile, which
    // `paths_cover_every_crate_a_web_wasm_package_compiles` keeps complete.
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
    // The flake and dev shell that choose wasm-pack, wasm-bindgen and binaryen.
    RepoGlob::new("flake.lock"),
    RepoGlob::new("flake.nix"),
    RepoGlob::new("nix/cloud-storage.nix"),
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
