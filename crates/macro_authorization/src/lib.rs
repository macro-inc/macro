#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates credentials through a cryptographic validation
//! port and returns the authenticated user's [`model_user::UserContext`].

#[cfg(feature = "outbound")]
mod builder;

pub mod domain;
/// Inbound transport adapters backed by the authorization service.
#[cfg(feature = "axum")]
pub mod inbound;
/// Adapters for validating credentials with external authentication systems.
#[cfg(feature = "outbound")]
pub mod outbound;
/// Authorization fakes and HTTP credential helpers for tests.
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use domain::{
    models::{MacroAuthorizationError, ValidatedIdentity},
    ports::{JwtValidator, MacroAuthorizationService},
    service::MacroAuthorizationServiceImpl,
};
/// Marker for a user context authorized before extractor execution.
#[cfg(all(feature = "axum", feature = "internal-identity"))]
pub use inbound::PreauthorizedContext;
/// Service-backed Axum authorization extractors and their rejection type.
#[cfg(feature = "axum")]
pub use inbound::{
    MacroAuthorizationExtractor, MacroAuthorizationExtractorFor, MacroAuthorizationRejection,
    MacroAuthorizationRejectionKind, OptionalMacroAuthorizationExtractor,
    OptionalMacroAuthorizationExtractorFor,
};
/// Permission-aware authorization extraction and service implementation.
#[cfg(feature = "permissions")]
pub use inbound::{
    PermissionedMacroAuthorizationExtractor, PermissionedMacroAuthorizationRejection,
    UserPermissionsServiceImpl,
};
/// JWT validator backed by the `macro_auth` implementation.
#[cfg(feature = "outbound")]
pub use outbound::MacroAuthJwtValidator;
