//! Notification service library.
//!
//! This crate provides a hexagonal architecture-based notification system
//! for sending notifications via multiple channels (WebSocket, push, email).

#![deny(missing_docs)]

/// Domain layer containing core business logic, models, and port definitions.
pub mod domain;
/// Inbound adapters (HTTP handlers, clients).
pub mod inbound;
/// Outbound adapters (database, Redis, WebSocket gateway, SNS, SES).
pub mod outbound;
