//! Outbound authorization adapters.

/// JWT validation backed by the shared `macro_auth` implementation.
pub mod macro_auth;
/// JWT validation adapter for internal-only services.
pub mod noop;

/// JWT validator backed by the shared `macro_auth` implementation.
pub use macro_auth::MacroAuthJwtValidator;
/// JWT validator for services that only support internal authorization.
pub use noop::NoopMacroAuthJwtValidator;
