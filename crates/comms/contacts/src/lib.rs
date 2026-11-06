//! Contacts service library.
//!
//! This crate provides a hexagonal architecture-based contacts system
//! for managing user connections and contact graphs.

#![deny(missing_docs)]

/// Domain layer containing core business logic, models, and port definitions.
pub mod domain;
/// Inbound adapters (HTTP handlers, queue worker).
pub mod inbound;
/// Outbound adapters (database, connection gateway).
pub mod outbound;
