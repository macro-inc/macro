//! Helper functions for property service implementation.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

/// Extract option IDs from a PropertyValue (matches properties_db_client pattern).
pub fn extract_option_ids_from_property_value(value: &Option<PropertyValue>) -> Vec<Uuid> {
    match value {
        Some(PropertyValue::SelectOption(ids)) => ids.clone(),
        _ => Vec::new(),
    }
}

/// Check if a property can be attached to the given entity type.
pub fn is_property_applicable_to(property_id: Uuid, entity_type: EntityType) -> bool {
    // Task-only properties: Parent Task and Subtasks
    if property_id == SystemPropertyKey::PARENT_TASK_UUID
        || property_id == SystemPropertyKey::SUBTASKS_UUID
    {
        return entity_type == EntityType::Task;
    }

    true
}
