//! Service layer entity property model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::EntityType;

/// Assignment of a property definition to a specific entity (service representation).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EntityProperty {
    pub id: Uuid,
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ===== Conversions =====

impl From<EntityProperty> for crate::api::EntityPropertyResponse {
    fn from(svc: EntityProperty) -> Self {
        Self {
            id: svc.id,
            entity_id: svc.entity_id,
            entity_type: svc.entity_type,
            property_definition_id: svc.property_definition_id,
            created_at: Some(svc.created_at),
            updated_at: Some(svc.updated_at),
        }
    }
}
