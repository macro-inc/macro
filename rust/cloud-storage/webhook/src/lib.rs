#![deny(missing_docs)]
//! Webhook management hex crate.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// HTTP adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres and HTTP adapters.
pub mod outbound;
