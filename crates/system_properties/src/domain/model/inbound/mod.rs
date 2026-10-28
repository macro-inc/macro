//! Inbound types - types from inbound adapters (commands/inputs).

mod crm_record_link;
mod email_attachment;
mod source_entity;

pub use crm_record_link::CrmRecordLink;
pub use email_attachment::{EmailAttachmentInput, EmailAttachmentProperty};
pub use source_entity::SourceEntity;
