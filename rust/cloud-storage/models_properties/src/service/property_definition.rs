//! Service layer property definition model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::{DataType, EntityType, PropertyOwner};

/// Property definition model (service representation).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PropertyDefinition {
    pub id: Uuid,
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Flag to indicate if this is a system-generated metadata property.
    /// Not stored in database - computed at service layer.
    pub is_metadata: bool,
}

// ===== Conversions =====

impl From<PropertyDefinition> for crate::api::PropertyDefinitionResponse {
    fn from(svc: PropertyDefinition) -> Self {
        Self {
            id: svc.id,
            owner: svc.owner,
            display_name: svc.display_name,
            data_type: svc.data_type,
            is_multi_select: svc.is_multi_select,
            specific_entity_type: svc.specific_entity_type,
            is_metadata: svc.is_metadata,
            created_at: Some(svc.created_at),
            updated_at: Some(svc.updated_at),
        }
    }
}
