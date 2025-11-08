//! Database layer property definition model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::{DataType, EntityType};

/// Property definition model (database representation).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PropertyDefinition {
    pub id: Uuid,
    pub organization_id: Option<i32>,
    pub user_id: Option<String>,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ===== Conversions =====

impl From<PropertyDefinition> for crate::service::property_definition::PropertyDefinition {
    fn from(db: PropertyDefinition) -> Self {
        use crate::shared::PropertyOwner;

        let owner = PropertyOwner::from_optional_ids(db.organization_id, db.user_id)
            .expect("PropertyDefinition must have at least one owner (user_id or organization_id)");

        Self {
            id: db.id,
            owner,
            display_name: db.display_name,
            data_type: db.data_type,
            is_multi_select: db.is_multi_select,
            specific_entity_type: db.specific_entity_type,
            created_at: db.created_at,
            updated_at: db.updated_at,
            // is_metadata is a service layer concept, not stored in DB
            // Default to false (user-defined property)
            is_metadata: false,
        }
    }
}
