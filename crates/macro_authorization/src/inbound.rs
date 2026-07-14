//! Inbound transport adapters for authorizing credentials.

/// Axum extractors backed by the authorization service.
pub mod axum;
/// Permission-aware authorization extraction and service type erasure.
#[cfg(feature = "permissions")]
pub mod permissions;

#[cfg(feature = "internal-identity")]
pub use axum::PreauthorizedContext;
pub use axum::{
    MacroAuthorizationExtractor, MacroAuthorizationExtractorFor, MacroAuthorizationRejection,
    MacroAuthorizationRejectionKind, OptionalMacroAuthorizationExtractor,
    OptionalMacroAuthorizationExtractorFor,
};
#[cfg(feature = "permissions")]
pub use permissions::{
    PermissionedMacroAuthorizationExtractor, PermissionedMacroAuthorizationRejection,
    UserPermissionsServiceHandle,
};
