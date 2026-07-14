//! Outbound authorization adapters.

/// JWT validation backed by the `macro_auth` implementation.
pub mod macro_auth;

/// JWT validator backed by the `macro_auth` implementation.
pub use macro_auth::MacroAuthJwtValidator;
