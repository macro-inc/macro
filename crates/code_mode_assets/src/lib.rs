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

/// Every service the SDK can reach, per environment (`dev`, `prod`, `local`),
/// keyed by its name in the SDK, with its host there, as JSON.
pub const HOSTS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/hosts.json"));

/// The SDK's TypeScript declarations that routine code is type-checked
/// against, with their fingerprint, as JSON.
pub const SDK_TYPES: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/sdk-types.json"));

/// The JS tools interpreter for Deno: `@opencode/codemode` with the may-call
/// analyzer and tool runtime (`packages/code-mode-sdk/src/js-tools`), as one
/// ES module. It holds no SDK; the bootstrap sends each tool call.
pub const JS_TOOLS: &str = include_str!(concat!(env!("CODE_MODE_ASSETS"), "/js-tools.mjs"));

/// The SDK operations JS tools programs call as `tools.<service>.<operation>`,
/// with each one's route and schemas, and those left out with the reason, as
/// JSON.
pub const JS_TOOLS_CATALOG: &str =
    include_str!(concat!(env!("CODE_MODE_ASSETS"), "/js-tools.json"));

/// What a JS tools run records as its SDK fingerprint:
/// `@opencode/codemode@<version>+<hash of JS_TOOLS and JS_TOOLS_CATALOG>`.
pub const JS_TOOLS_FINGERPRINT: &str =
    include_str!(concat!(env!("CODE_MODE_ASSETS"), "/js-tools.fingerprint"));
