//! The assets code mode embeds, generated from the public SDK by
//! `packages/code-mode-sdk/scripts/generate.ts` when this crate builds (see
//! `build.rs`).

/// The public SDK bundled as one ES module for Deno.
pub const SDK: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/sdk.mjs"));

/// Handlebars bundled as one ES module for Deno.
pub const HANDLEBARS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/handlebars.mjs"));

/// The agent SDK catalog: an index per entity and a reference per symbol, as JSON.
pub const DOCUMENTATION: &str =
    include_str!(concat!(env!("CODE_MODE_ASSETS"), "/documentation.json"));

/// Display labels for every generated SDK operation, keyed `service.method`, as JSON.
pub const OPERATIONS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/operations.json"));

/// One file of the code-split Lexical modules, written under the run's root.
#[derive(Debug, Clone, Copy)]
pub struct LexicalModule {
    /// Path relative to the run's root, such as `lexical/Lexical.dev.js`.
    pub path: &'static str,
    /// The import specifier it serves (`lexical`, `@lexical/list`,
    /// `@macro-inc/sdk/lexical`); `None` for a shared chunk.
    pub specifier: Option<&'static str>,
    /// The module source.
    pub source: &'static str,
}

/// `lexical`, the `@lexical/*` packages documents use and
/// `@macro-inc/sdk/lexical`, which `sdk.mjs` imports by specifier.
pub const LEXICAL_MODULES: &[LexicalModule] =
    include!(concat!(env!("OUT_DIR"), "/lexical_modules.rs"));
