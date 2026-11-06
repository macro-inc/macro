//! Database layer entity property model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::EntityType;

/// Assignment of a property definition to a specific entity (database representation).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct EntityProperty {
    pub id: Uuid,
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ===== Conversions =====

impl From<EntityProperty> for crate::service::entity_property::EntityProperty {
    fn from(db: EntityProperty) -> Self {
        Self {
            id: db.id,
            entity_id: db.entity_id,
            entity_type: db.entity_type,
            property_definition_id: db.property_definition_id,
            created_at: db.created_at,
            updated_at: db.updated_at,
        }
    }
}
