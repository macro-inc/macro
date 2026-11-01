//! Adapters that drive the fold from outside.
//!
//! There are two: [`wire`], the envelopes around the domain vocabulary that
//! readers receive, and [`wasm`], the wasm-bindgen glue that carries them to
//! the browser. Services call [`crate::domain::ports::FoldedMessageRepo`]
//! directly. The web client folds for itself; `agent_session` serves the same
//! [`wire`] messages over HTTP for readers that do not, such as the SDK.

/// Browser-specific wire envelopes, kept apart from the wasm-bindgen glue so
/// a native binary can derive TypeScript from them. See the module docs.
pub mod wire;

/// The wasm-bindgen entry point the web client folds through.
#[cfg(target_arch = "wasm32")]
pub mod wasm;
