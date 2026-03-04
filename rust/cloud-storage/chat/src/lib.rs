#![deny(missing_docs)]
//! Chat domain crate — hex-architecture abstraction over the Chat and ChatMessage tables.

/// Chat domain layer — ports and service logic.
pub mod domain;
/// Inbound HTTP handlers.
pub mod inbound;
/// Types used by the chat domain.
pub mod models;
/// Outbound adapters (database, etc.).
pub mod outbound;
