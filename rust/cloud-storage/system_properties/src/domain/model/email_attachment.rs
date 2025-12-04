//! Email attachment property types.

use super::source_entity::SourceEntity;

/// Email attachment properties to set on an entity.
#[derive(Debug, Clone, Default)]
pub struct EmailAttachmentProperty {
    /// Source entity reference (single).
    pub source: Option<SourceEntity>,
    /// Company entity IDs.
    pub companies: Option<Vec<String>>,
    /// Sender user ID.
    pub sender: Option<String>,
    /// Recipient user IDs.
    pub recipients: Option<Vec<String>>,
    /// Subject line.
    pub subject: Option<String>,
}

/// Input for bulk email attachment property setting.
#[derive(Debug, Clone)]
pub struct EmailAttachmentInput {
    /// The entity ID to set properties on.
    pub entity_id: String,
    /// The properties to set.
    pub properties: EmailAttachmentProperty,
}
