#![deny(missing_docs)]
//! Bot management hex crate.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// HTTP adapters.
pub mod inbound;
#[cfg(feature = "authorizer")]
/// Adapter from the bot service to the shared authorization port.
pub mod macro_authorization_adapter;
#[cfg(feature = "outbound")]
/// Postgres adapters.
pub mod outbound;
