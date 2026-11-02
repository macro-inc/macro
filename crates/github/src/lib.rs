//! Documents hexagonal architecture crate.
//!
//! Encapsulates document CRUD operations using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL, GitHub)
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)

#![deny(missing_docs)]
pub mod domain;

pub mod broker;

#[cfg(any(
    feature = "outbound",
    feature = "sync",
    feature = "installation_claims"
))]
pub mod outbound;

#[cfg(feature = "inbound")]
pub mod inbound;
