//! Properties Models
//!
//! This crate defines the data models for the properties system using a three-layer architecture:
//!
//! - **shared**: Shared types (EntityType, DataType) used across all layers
//! - **service**: Business logic layer types (used within properties_service)
//! - **api**: API layer types (external-facing requests/responses)

pub mod api;
pub mod service;
pub mod shared;

// Re-export commonly used shared types for convenience
pub use shared::{DataType, EntityReference, EntityType, PropertyOwner};
