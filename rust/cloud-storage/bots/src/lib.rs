#![deny(missing_docs)]
//! Bot management hex crate.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(feature = "inbound")]
/// HTTP adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres adapters.
pub mod outbound;
