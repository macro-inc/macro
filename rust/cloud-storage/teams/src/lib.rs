#![deny(missing_docs)]
//! Teams hexagonal architecture crate.
//!
//! Encapsulates team management operations using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL, Stripe)
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)

/// The domain module contains the domain logic for teams
pub mod domain;

/// The inbound module contains the inbound adapters for teams
#[cfg(feature = "inbound")]
pub mod inbound;

/// The outbound module contains the outbound logic for teams
#[cfg(feature = "outbound")]
pub mod outbound;
