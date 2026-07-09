//! Helper functions for property service implementation.

use entity_access::domain::models::EntityAccessAuth;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType, PropertyOwner};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

/// Whether a tag-typed property with the given owner is visible to the caller.
/// A user-owned tag set (personal labels) is visible only to its owner, so
/// personal tags stay private even on a shared entity. Team- and system-owned
/// tags are the shared vocabulary and are always visible. Internal (machine)
/// callers see everything.
fn tag_visible_to(owner: &PropertyOwner, auth: &EntityAccessAuth) -> bool {
    match owner {
        PropertyOwner::User { user_id } => match auth {
            EntityAccessAuth::Authenticated(caller) => user_id == caller.as_ref(),
            EntityAccessAuth::Unauthenticated => false,
            EntityAccessAuth::Internal => true,
        },
        PropertyOwner::Team { .. } | PropertyOwner::System => true,
    }
}

/// Drops tag-typed properties the caller may not see. Non-tag properties are
/// unaffected.
pub fn retain_caller_visible_tags(
    properties: &mut Vec<EntityPropertyWithDefinition>,
    auth: &EntityAccessAuth,
) {
    properties.retain(|property| {
        property.definition.data_type != DataType::Tag
            || tag_visible_to(&property.definition.owner, auth)
    });
}

/// Extract option IDs from a PropertyValue.
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

    // CRM-company-only properties: Stage, Owner, Revenue
    if property_id == SystemPropertyKey::STAGE_UUID
        || property_id == SystemPropertyKey::COMPANY_OWNER_UUID
        || property_id == SystemPropertyKey::REVENUE_UUID
    {
        return entity_type == EntityType::Company;
    }

    true
}
