#![deny(missing_docs)]
//! CRM hexagonal architecture crate.
//!
//! Encapsulates CRM-style records (external organizations, their domains and
//! contacts) tracked by a team, using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL)

/// The domain module contains the domain logic for CRM
pub mod domain;

/// The inbound module contains the inbound adapters for CRM
#[cfg(feature = "inbound")]
pub mod inbound;

/// The outbound module contains the outbound adapters for CRM
#[cfg(any(feature = "outbound", feature = "search"))]
pub mod outbound;
