#![deny(missing_docs)]
//! Chat domain crate — hex-architecture abstraction over the Chat and ChatMessage tables.

/// Chat domain layer — ports, models, and service logic.
pub mod domain;
/// Inbound HTTP handlers.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Outbound adapters (database, etc.).
#[cfg(feature = "outbound")]
pub mod outbound;
