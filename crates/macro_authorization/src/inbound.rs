//! Inbound transport adapters for authorizing credentials.

/// Axum extractors backed by the authorization service.
pub mod axum;

#[cfg(feature = "internal-identity")]
pub use axum::PreauthorizedContext;
pub use axum::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, MacroAuthorizationRejectionKind,
    OptionalMacroAuthorizationExtractor, OptionalSharedMacroAuthorizationExtractor,
    SharedMacroAuthorizationExtractor,
};
