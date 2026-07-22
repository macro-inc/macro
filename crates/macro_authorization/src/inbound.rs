//! Inbound transport adapters for authorizing credentials.

/// Axum extractors backed by the authorization service.
pub mod axum;

#[allow(deprecated)]
pub use axum::{
    ActingEntity, BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_TOKEN_HEADER, BotMacroAuthorizationExtractor,
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalMacroAuthorizationExtractor, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorizationExtractor,
    MacroAuthorizationRejection, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    UserMacroAuthorizationExtractor,
};
