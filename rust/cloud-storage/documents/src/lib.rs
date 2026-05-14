//! Documents hexagonal architecture crate.
//!
//! Encapsulates document CRUD operations using a ports-and-adapters pattern.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL)
//! - **inbound**: Contains adapters for incoming requests (Axum handlers)

#![deny(missing_docs)]

pub mod domain;

#[cfg(any(feature = "inbound", feature = "ai_tools", feature = "attachment"))]
pub mod inbound;

#[cfg(any(
    feature = "outbound",
    feature = "markdown_init",
    feature = "document_create_adapters"
))]
pub mod outbound;
