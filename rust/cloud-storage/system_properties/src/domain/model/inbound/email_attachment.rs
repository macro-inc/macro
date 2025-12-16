//! Email attachment property types.

use super::source_entity::SourceEntity;
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::MacroUserId;

/// Email attachment properties to set on an entity.
#[derive(Debug, Clone, Default)]
pub struct EmailAttachmentProperty<'a> {
    /// Source entity reference (single).
    pub source: Option<SourceEntity>,
    /// Company entity IDs.
    pub companies: Option<Vec<String>>,
    /// Sender user ID.
    pub sender: Option<MacroUserId<Lowercase<'a>>>,
    /// Recipient user IDs.
    pub recipients: Option<Vec<MacroUserId<Lowercase<'a>>>>,
    /// Subject line.
    pub subject: Option<String>,
}

/// Input for bulk email attachment property setting.
#[derive(Debug, Clone)]
pub struct EmailAttachmentInput<'a> {
    /// The entity ID to set properties on.
    pub entity_id: String,
    /// The properties to set.
    pub properties: EmailAttachmentProperty<'a>,
}
