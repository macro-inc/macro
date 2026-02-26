//! Documents hexagonal architecture crate.
//!
//! Encapsulates document CRUD operations using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL, GitHub)

#![deny(missing_docs)]
pub mod domain;

#[cfg(feature = "outbound")]
pub mod outbound;
