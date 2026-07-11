//! Foreign entity hexagonal architecture crate.
//!
//! Encapsulates CRUD operations for external entity mappings using a
//! ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports, and service implementation.
//! - **outbound**: Contains adapters for external persistence systems.

#![deny(missing_docs)]

pub mod domain;

/// Inbound adapters for serving foreign entity APIs.
#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
