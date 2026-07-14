//! Inbound types - types from inbound adapters (commands/inputs).

mod email_attachment;
mod source_entity;

pub use email_attachment::{EmailAttachmentInput, EmailAttachmentProperty};
pub use source_entity::SourceEntity;
