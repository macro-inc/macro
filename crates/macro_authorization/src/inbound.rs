//! Inbound transport adapters for authorizing credentials.

/// Axum extractors backed by the authorization service.
pub mod axum;

pub use axum::{
    MacroAuthorizationExtractor, MacroAuthorizationRejection, OptionalMacroAuthorizationExtractor,
};
