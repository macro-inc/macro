//! Entity access control for cloud storage.
//!
//! This crate provides a hexagonal architecture implementation for checking
//! user access levels to various entities (documents, chats, projects, etc.).
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL)
//! - **inbound**: Contains adapters for incoming requests (Axum extractors)
//!
//! # Usage
//!
//! ```ignore
//! use entity_access::{
//!     domain::{ports::EntityAccessService, service::EntityAccessServiceImpl},
//!     outbound::PgAccessRepository,
//! };
//!
//! let pool: sqlx::PgPool = /* ... */;
//! let repo = PgAccessRepository::new(pool);
//! let service = EntityAccessServiceImpl::new(repo);
//!
//! // Check access
//! let access = service.get_access_level("user-id", "doc-id", EntityType::Document).await?;
//! ```

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
