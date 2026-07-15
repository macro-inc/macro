#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates credentials through a cryptographic validation
//! port and returns the authenticated user's [`model_user::UserContext`].

pub mod domain;
/// Inbound transport adapters backed by the authorization service.
#[cfg(feature = "axum")]
pub mod inbound;
/// Adapters for validating credentials with external authentication systems.
#[cfg(feature = "outbound")]
pub mod outbound;

pub use domain::{
    models::{
        InternalAuthConfig, InternalIdentityClaims, MacroAuthorizationError, ValidatedIdentity,
    },
    ports::{JwtValidator, MacroAuthorizationService},
    service::MacroAuthorizationServiceImpl,
};
/// Service-backed Axum authorization extractors, state, headers, and rejection type.
#[allow(deprecated)]
#[cfg(feature = "axum")]
pub use inbound::{
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalMacroAuthorizationExtractor, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};
/// JWT validator backed by the shared `macro_auth` implementation.
#[cfg(feature = "outbound")]
pub use outbound::MacroAuthJwtValidator;
