//! Platform status: the banner every Macro user sees while the platform is
//! degraded or down.
//!
//! Macro staff set the status (operational, degraded, or major outage, with a
//! message for the latter two). Every update is kept as history; the newest is
//! the current status, and setting it is broadcast to every open app over the
//! connection gateway.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service implementation
//! - **outbound**: PostgreSQL storage and the connection gateway broadcaster
//! - **inbound**: Axum handlers

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
