//! System properties crate.
//!
//! Provides types and database operations for system-managed properties.
//! System properties are predefined by the system and cannot be created or deleted by users,
//! but users can apply them to entities and manage their values.

pub mod error;
pub mod repository;
pub mod types;

pub use error::SystemPropertyError;
pub use repository::{
    EmailAttachmentInput, EmailAttachmentProperty, SourceEntity, SystemProperties,
};
pub use types::{EffortOption, PriorityOption, StatusOption, SystemPropertyKey};
