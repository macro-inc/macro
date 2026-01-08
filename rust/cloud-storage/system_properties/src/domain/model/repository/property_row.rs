//! Property row for repository persistence.

use models_properties::EntityType;
use uuid::Uuid;

/// A single property row to upsert.
///
/// Fields are private to enforce valid JSON structure via constructors.
#[derive(Debug)]
pub struct PropertyRow {
    entity_id: String,
    entity_type: EntityType,
    property_definition_id: Uuid,
    values: serde_json::Value,
}

impl PropertyRow {
    // =========================================================================
    // Constructors - enforce valid JSON structure
    // =========================================================================

    /// Create a property row with entity references.
    ///
    /// `specific_message_id` is included on each reference if provided.
    /// Use this for CHANNEL/CHAT/THREAD refs that need message context.
    pub fn entity_reference(
        entity_id: impl Into<String>,
        entity_type: EntityType,
        property_definition_id: Uuid,
        ref_type: EntityType,
        ref_ids: Vec<String>,
        specific_message_id: Option<Uuid>,
    ) -> Self {
        let refs: Vec<serde_json::Value> = ref_ids
            .into_iter()
            .map(|id| {
                let mut obj = serde_json::json!({
                    "entity_type": ref_type,
                    "entity_id": id
                });
                if let Some(ref msg_id) = specific_message_id {
                    obj.as_object_mut()
                        .expect("json object")
                        .insert("specific_message_id".to_string(), serde_json::json!(msg_id));
                }
                obj
            })
            .collect();

        Self {
            entity_id: entity_id.into(),
            entity_type,
            property_definition_id,
            values: serde_json::json!({
                "type": "EntityReference",
                "value": refs
            }),
        }
    }

    /// Create a property row with a string value.
    pub fn string_value(
        entity_id: impl Into<String>,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: impl Into<String>,
    ) -> Self {
        Self {
            entity_id: entity_id.into(),
            entity_type,
            property_definition_id,
            values: serde_json::json!({
                "type": "String",
                "value": value.into()
            }),
        }
    }

    /// Create a property row with a null JSON value.
    ///
    /// Used to initialize system properties with empty/null values.
    pub fn null_value(
        entity_id: impl Into<String>,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> Self {
        Self {
            entity_id: entity_id.into(),
            entity_type,
            property_definition_id,
            values: serde_json::Value::Null,
        }
    }

    // =========================================================================
    // Getters - for repository access
    // =========================================================================

    /// Get the entity ID.
    pub fn entity_id(&self) -> &str {
        &self.entity_id
    }

    /// Get the entity type.
    pub fn entity_type(&self) -> EntityType {
        self.entity_type
    }

    /// Get the property definition ID.
    pub fn property_definition_id(&self) -> Uuid {
        self.property_definition_id
    }

    /// Get the values JSON.
    pub fn values(&self) -> &serde_json::Value {
        &self.values
    }
}
