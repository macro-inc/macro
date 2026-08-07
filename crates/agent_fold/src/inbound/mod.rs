//! Adapters that drive the fold from outside.
//!
//! There is one: [`wasm`], the browser's. Services do not need an adapter -
//! they call [`crate::domain::ports::FoldedMessageRepo`] directly - and the
//! HTTP surface that used to fold on their behalf is gone, because the client
//! folds for itself now.

/// The wasm-bindgen entry point the web client folds through.
#[cfg(target_arch = "wasm32")]
pub mod wasm;
