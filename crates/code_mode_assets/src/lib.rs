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

/// Every generated SDK operation, keyed `service.method`, with its display
/// label, HTTP method, path and whether it can write, as JSON.
pub const OPERATIONS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/operations.json"));

/// The SDK's TypeScript declarations that routine code is type-checked
/// against, with their fingerprint, as JSON.
pub const SDK_TYPES: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/sdk-types.json"));
