//! Canonical entity targets accepted by property APIs.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Canonical type of an entity receiving properties.
///
/// Tasks are documents at API boundaries. `Task` intentionally does not exist
/// here; task classification is resolved by the properties domain from the
/// document subtype.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PropertyTargetEntityType {
    /// Voice/video call.
    CallRecord,
    /// Channel conversation.
    Channel,
    /// AI chat.
    Chat,
    /// CRM company.
    Company,
    /// Document, including tasks and snippets.
    Document,
    /// Project.
    Project,
    /// Email thread.
    Thread,
    /// User.
    User,
}

/// Canonical reference to an entity receiving properties.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash)]
pub struct PropertyTargetReference {
    /// Entity identifier.
    pub entity_id: String,
    /// Canonical entity type.
    pub entity_type: PropertyTargetEntityType,
}
