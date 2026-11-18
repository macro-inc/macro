//! The assets code mode embeds, generated from the public SDK by
//! `packages/code-mode-sdk/scripts/generate.ts` when this crate builds (see
//! `build.rs`).

/// The public SDK bundled as one ES module for Deno.
pub const SDK: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/sdk.mjs"));

/// Handlebars bundled as one ES module for Deno.
pub const HANDLEBARS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/handlebars.mjs"));

/// Photon's JavaScript glue, bundled as one ES module for Deno. It loads
/// [`PHOTON_WASM`] from beside itself at import time.
pub const PHOTON: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/photon.mjs"));

/// Photon's WebAssembly image editing code, checked at build time by the
/// generator.
pub const PHOTON_WASM: &[u8] = include_bytes!(concat!(env!("CODE_MODE_ASSETS"), "/photon.wasm"));

/// The agent SDK catalog: an index per entity and a reference per symbol, as JSON.
pub const DOCUMENTATION: &str =
    include_str!(concat!(env!("CODE_MODE_ASSETS"), "/documentation.json"));

/// Every generated SDK operation, keyed `service.method`, with its display
/// label, HTTP method, path and whether it can write, as JSON.
pub const OPERATIONS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/operations.json"));

/// Every service the SDK can reach, per environment (`dev`, `prod`, `local`),
/// keyed by its name in the SDK, with its host there, as JSON.
pub const HOSTS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/hosts.json"));

/// The SDK's TypeScript declarations that routine code is type-checked
/// against, with their fingerprint, as JSON.
pub const SDK_TYPES: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/sdk-types.json"));
