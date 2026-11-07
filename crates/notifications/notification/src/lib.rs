//! Notification service library.
//!
//! This crate provides a hexagonal architecture-based notification system
//! for sending notifications via multiple channels (WebSocket, push, email).
//!
//! This crate is the domain. The HTTP routes, AI tool and queue workers are
//! `notification_inbound`; the database, queue, Redis, WebSocket gateway, SNS
//! and SES adapters are `notification_outbound`.

#![deny(missing_docs)]

/// Domain layer containing core business logic, models, and port definitions.
pub mod domain;
