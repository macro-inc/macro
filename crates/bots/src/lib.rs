#![deny(missing_docs)]
//! Bot management hex crate.

/// Domain models, ports, and service.
pub mod domain;
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
/// Inbound HTTP and AI-tool adapters.
pub mod inbound;
#[cfg(feature = "outbound")]
/// Postgres adapters.
pub mod outbound;
