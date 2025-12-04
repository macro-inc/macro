//! System properties crate.
//!
//! Provides types and database operations for system-managed properties.
//! System properties are predefined by the system and cannot be created or deleted by users,
//! but users can apply them to entities and manage their values.
//!
//! # Architecture
//!
//! This crate follows hexagonal architecture:
//! - `domain::model` - Domain models (entities, value objects, errors)
//! - `domain::port` - Port definitions (traits/interfaces)
//! - `domain::service` - Service trait and implementation
//! - `outbound` - Outbound adapters (e.g., PostgreSQL implementation)
//!
//! # Example
//!
//! ```ignore
//! use system_properties::{
//!     domain::{
//!         model::{EmailAttachmentInput, EmailAttachmentProperty},
//!         service::{SystemPropertiesService, SystemPropertiesServiceImpl},
//!     },
//!     outbound::pgpool::PgSystemPropertiesRepository,
//! };
//!
//! let repository = PgSystemPropertiesRepository::new(pool);
//! let service = SystemPropertiesServiceImpl::new(repository);
//!
//! service.set_email_attachment_properties(vec![
//!     EmailAttachmentInput {
//!         entity_id: "doc_123".to_string(),
//!         entity_type: EntityType::Document,
//!         properties: EmailAttachmentProperty {
//!             subject: Some("Hello".to_string()),
//!             ..Default::default()
//!         },
//!     },
//! ]).await?;
//! ```

/// Domain layer containing models, ports, and services.
pub mod domain;

/// Outbound adapters for database implementations.
pub mod outbound;

// Re-export commonly used types for convenience
pub use domain::model::PropertyRow;
pub use domain::model::{
    EffortOption, EmailAttachmentInput, EmailAttachmentProperty, PriorityOption, SourceEntity,
    StatusOption, SystemPropertyError, SystemPropertyKey,
};
pub use domain::port::SystemPropertiesRepository;
pub use domain::service::{SystemPropertiesService, SystemPropertiesServiceImpl};
pub use outbound::pgpool::PgSystemPropertiesRepository;
