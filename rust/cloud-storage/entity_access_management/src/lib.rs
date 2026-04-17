//! Entity access management for cloud storage.
//!
//! This crate provides a hexagonal architecture implementation for managing
//! CRUD operations on entity access.
//!
//! # Architecture
//!
//! - **domain**: Contains domain models, ports (traits), and the service implementation
//! - **outbound**: Contains adapters for external dependencies (PostgreSQL)

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "outbound")]
pub mod outbound;
