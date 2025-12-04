//! Domain models for system properties.

mod constants;
mod error;
mod inbound;
mod repository;

pub use constants::{EffortOption, PriorityOption, StatusOption, SystemPropertyKey};
pub use error::SystemPropertyError;
pub use inbound::{EmailAttachmentInput, EmailAttachmentProperty, SourceEntity};
pub use repository::PropertyRow;
