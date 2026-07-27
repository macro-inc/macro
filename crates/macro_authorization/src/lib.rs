#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates user, bot, and internal service credentials and
//! returns a typed principal with any authenticated or verified acting user.
//! [`MacroAuthorizationServiceImpl::new`] requires bot authorization to be
//! configured explicitly, just like internal authorization. Services backed by
//! MacroDB should use `PgBotAuthorizer`; services that intentionally reject
//! bot credentials must pass [`NoBotAuthorizer`].
//!
//! # Choosing an Axum extractor
//!
//! The `axum` feature provides a required [`MacroAuthorizationExtractor`] and
//! an [`OptionalMacroAuthorizationExtractor`] for endpoints that permit
//! anonymous requests. Both require an explicit [`AuthorizationPolicy`] type:
//!
//! | Policy | Admitted principals | Narrowed output |
//! |---|---|---|
//! | [`UserOrInternal`] | User or internal service acting for a user | [`UserOrInternalAuthorization`] |
//! | [`UserOrInternalService`] | User or internal service, with optional acting user | [`UserOrInternalServiceAuthorization`] |
//! | [`ActingUser`] | Any principal with an acting user | [`ActingUserAuthorization`] |
//! | [`UserOnly`] | Directly authenticated user | [`MacroUserAuthentication`] |
//! | [`BotOnly`] | Bot, with optional acting user | [`BotAuthentication`] |
//! | [`InternalOnly`] | Internal service, with optional acting user | [`InternalAuthorization`] |
//! | [`AnyPrincipal`] | Any authenticated principal | [`MacroAuthorization`] |
//!
//! Bot requests must include `x-macro-bot-scope` with the value `user` or
//! `team`; a missing or invalid scope is rejected with `400 Bad Request`, and
//! only a team-owned bot may request team scope. Successful bot authorization
//! includes the owning team ID when the bot is team-owned.
//! Both extractors reject requests that combine explicit credential types
//! (internal key, bot token, or user query/bearer) with `400 Bad Request` rather
//! than choosing a principal. Query and bearer credentials are one user type,
//! while access-token cookies are ambient; an explicit credential wins over a
//! cookie. Local-auth fallback and cookies are considered only when no explicit
//! credential is present. A valid principal not admitted by the selected policy
//! is rejected with `403 Forbidden`.
//!
//! These extractors authenticate the caller; they do not decide whether that
//! caller may act on a particular entity. Entity authorization and business
//! policy belong in the domain layer, typically using a typed entity-access
//! receipt.

pub mod domain;
/// Inbound transport adapters backed by the authorization service.
#[cfg(feature = "axum")]
pub mod inbound;
/// Adapters for validating credentials with external authentication systems and PostgreSQL.
#[cfg(any(feature = "outbound", feature = "postgres"))]
pub mod outbound;

pub use domain::{
    bot_authorizer::BotAuthorizerService,
    models::{
        BotActingUserClaims, BotAuthentication, BotAuthorizationOwner, BotScope,
        BotTokenAuthorization, InternalAuthConfig, InternalIdentityClaims, MacroAuthorization,
        MacroAuthorizationError, MacroUserAuthentication, ResolvedBotActingUser, ValidatedIdentity,
    },
    ports::{
        BotAuthorizationRepo, BotAuthorizer, JwtValidator, MacroAuthorizationService,
        NoBotAuthorizer,
    },
    service::MacroAuthorizationServiceImpl,
};
/// Service-backed Axum authorization extractors, state, headers, and rejection type.
#[allow(deprecated)]
#[cfg(feature = "axum")]
pub use inbound::{
    ActingEntity, ActingUser, ActingUserAuthorization, AnyPrincipal, AuthorizationPolicy,
    BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotOnly,
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalAuthorization,
    InternalEntity, InternalOnly, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    UserOnly, UserOrInternal, UserOrInternalAuthorization, UserOrInternalCaller,
    UserOrInternalEntity, UserOrInternalService, UserOrInternalServiceAuthorization,
};
/// JWT validation adapters for user-authenticated and internal-only services.
#[cfg(feature = "outbound")]
pub use outbound::{MacroAuthJwtValidator, NoopMacroAuthJwtValidator};
/// PostgreSQL bot authorization repository and concrete authorizer.
#[cfg(feature = "postgres")]
pub use outbound::{PgBotAuthorizationRepo, PgBotAuthorizer};
