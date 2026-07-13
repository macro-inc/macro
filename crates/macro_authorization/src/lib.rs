#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates credentials through a cryptographic validation
//! port and returns the authenticated user's [`model_user::UserContext`].

pub mod domain;
/// Adapters for validating credentials with external authentication systems.
#[cfg(feature = "outbound")]
pub mod outbound;

pub use domain::{
    models::{MacroAuthorizationError, ValidatedIdentity},
    ports::{JwtValidator, MacroAuthorizationService},
    service::MacroAuthorizationServiceImpl,
};
/// JWT validator backed by the shared `macro_auth` implementation.
#[cfg(feature = "outbound")]
pub use outbound::MacroAuthJwtValidator;
