//! Adapters that drive the fold from outside.
//!
//! There are two: [`wire`], the browser-specific envelopes around the domain
//! vocabulary, and [`wasm`], the wasm-bindgen glue that carries them there. Services do not need an
//! adapter - they call [`crate::domain::ports::FoldedMessageRepo`] directly -
//! and the HTTP surface that used to fold on their behalf is gone, because
//! the client folds for itself now.

/// Browser-specific wire envelopes, kept apart from the wasm-bindgen glue so
/// a native binary can derive TypeScript from them. See the module docs.
pub mod wire;

/// The wasm-bindgen entry point the web client folds through.
#[cfg(target_arch = "wasm32")]
pub mod wasm;
