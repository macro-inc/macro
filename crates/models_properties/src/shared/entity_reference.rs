//! Entity reference type shared across all layers.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::EntityType;

/// Entity reference for entity-type property values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct EntityReference {
    pub entity_id: String,
    pub entity_type: EntityType,
    /// For CHANNEL, CHAT, THREAD entity types - optional specific message ID.
    /// This allows referencing a specific message within a thread/channel/chat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub specific_message_id: Option<Uuid>,
}

impl EntityReference {
    /// Create a new entity reference without a specific message ID
    pub fn new(entity_id: impl Into<String>, entity_type: EntityType) -> Self {
        Self {
            entity_id: entity_id.into(),
            entity_type,
            specific_message_id: None,
        }
    }

    /// Create a new entity reference with a specific message ID
    pub fn with_message_id(
        entity_id: impl Into<String>,
        entity_type: EntityType,
        message_id: Uuid,
    ) -> Self {
        Self {
            entity_id: entity_id.into(),
            entity_type,
            specific_message_id: Some(message_id),
        }
    }
}

/// Reference to an entity property, including the property definition ID.
/// Used for property lookups and deletion validation.
#[derive(Debug, Clone)]
pub struct EntityPropertyReference {
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
}
