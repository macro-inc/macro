#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates user, bot, and internal service credentials and
//! returns a typed principal with any authenticated or verified acting user.
//!
//! # Choosing an Axum extractor
//!
//! The `axum` feature provides four request extractors:
//!
//! - [`MacroAuthorizationExtractor`] requires an acting user. It accepts user,
//!   bot, or internal service credentials and exposes the typed
//!   [`MacroAuthorization`] principal alongside user convenience fields. Bot
//!   and internal requests must resolve to a user.
//! - [`OptionalMacroAuthorizationExtractor`] additionally supports anonymous,
//!   identityless bot, and identityless internal callers. Its optional
//!   [`MacroAuthorization`] distinguishes those security states.
//! - [`InternalMacroAuthorizationExtractor`] guards internal-only endpoints. It
//!   validates only an internal API key and exposes no user identity.
//! - [`BotMacroAuthorizationExtractor`] guards bot-only endpoints. It validates
//!   only [`BOT_TOKEN_HEADER`] and carries the authenticated bot principal.
//!
//! The general required and optional extractors reject requests that combine
//! explicit credential types (internal key, bot token, or user query/bearer)
//! with `400 Bad Request` rather than choosing a principal. Query and bearer
//! credentials are one user type, while access-token cookies are ambient; an
//! explicit credential wins over a cookie. Local-auth fallback and cookies are
//! considered only when no explicit credential is present. Dedicated bot and
//! internal extractors are exempt and never substitute another credential
//! type. Use them only when that exclusive caller type is part of the
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
        BotActingUserClaims, BotAuthentication, InternalAuthConfig, InternalIdentityClaims,
        MacroAuthorization, MacroAuthorizationError, MacroUserAuthentication, ValidatedIdentity,
    },
    ports::{BotAuthorizer, JwtValidator, MacroAuthorizationService, NoBotAuthorizer},
    service::MacroAuthorizationServiceImpl,
};
/// Service-backed Axum authorization extractors, state, headers, and rejection type.
#[allow(deprecated)]
#[cfg(feature = "axum")]
pub use inbound::{
    BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_TOKEN_HEADER, BotMacroAuthorizationExtractor,
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalMacroAuthorizationExtractor, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};
/// JWT validation adapters for user-authenticated and internal-only services.
#[cfg(feature = "outbound")]
pub use outbound::{MacroAuthJwtValidator, NoopMacroAuthJwtValidator};
