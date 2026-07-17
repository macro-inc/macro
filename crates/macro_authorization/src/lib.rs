#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates credentials through a cryptographic validation
//! port and returns the authenticated user's [`model_user::UserContext`].
//!
//! # Choosing an Axum extractor
//!
//! The `axum` feature provides three request extractors:
//!
//! - [`MacroAuthorizationExtractor`] requires an acting user. It accepts either
//!   user credentials or internal service credentials automatically. An
//!   internal request must resolve to a user through its acting-user header or
//!   [`InternalAuthConfig::default_user_id`].
//! - [`OptionalMacroAuthorizationExtractor`] supports anonymous, authenticated
//!   user, and internal service callers. Missing credentials succeed without a
//!   user identity, but supplied invalid or expired credentials are rejected.
//! - [`InternalMacroAuthorizationExtractor`] is for endpoints that will only
//!   ever be called by trusted internal services. It requires an internal API
//!   key, does not accept user credentials as a substitute, and exposes no user
//!   identity.
//!
//! [`MacroAuthorizationExtractor`] and [`OptionalMacroAuthorizationExtractor`]
//! detect internal headers before user credentials, validate the internal key,
//! and set `is_internal_access` to `true`. Do not add
//! [`InternalMacroAuthorizationExtractor`] merely to let an internal service
//! call an endpoint: use it only when being internal-only is part of the
//! endpoint's security contract.
//!
//! These extractors authenticate the caller; they do not decide whether that
//! caller may act on a particular entity. Entity authorization and business
//! policy belong in the domain layer, typically using a typed entity-access
//! receipt.

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
/// JWT validation adapters for user-authenticated and internal-only services.
#[cfg(feature = "outbound")]
pub use outbound::{MacroAuthJwtValidator, NoopMacroAuthJwtValidator};
