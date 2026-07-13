#![deny(missing_docs)]
//! Transport-independent authorization services and optional transport adapters.
//!
//! The domain layer validates credentials through a cryptographic validation
//! port and returns the authenticated user's [`model_user::UserContext`].

pub mod domain;

pub use domain::{
    models::{MacroAuthorizationError, ValidatedIdentity},
    ports::{JwtValidator, MacroAuthorizationService},
    service::MacroAuthorizationServiceImpl,
};
