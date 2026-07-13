//! Connection hexagonal architecture crate.
//!
//! Encapsulates connection gateway operations using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "outbound")]
pub mod outbound;
