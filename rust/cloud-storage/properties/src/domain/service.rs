//! Service trait for properties.

use models_properties::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::property_value::PropertyValue;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::error::PropertiesErr;
use super::model::EntityPropertyInfo;

/// Service trait for property operations.
pub trait PropertiesService: Send + Sync + 'static {
    /// Set an entity's status system property to "Completed".
    /// No-op if the entity doesn't have a status property.
    fn set_system_property_status_complete(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Bidirectionally link or unlink a task's parent.
    ///
    /// When `parent_task_id` is `Some(parent)`:
    /// - Sets task's Parent Task = parent
    /// - Adds task to parent's Subtasks
    /// - Removes task from old parent's Subtasks (if different)
    ///
    /// When `parent_task_id` is `None`:
    /// - Clears task's Parent Task
    /// - Removes task from old parent's Subtasks
    fn link_parent_task(
        &self,
        task_id: Uuid,
        parent_task_id: Option<Uuid>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Bidirectionally set a task's subtasks.
    ///
    /// - Sets task's Subtasks to the new list
    /// - For added subtasks: sets their Parent Task = task
    /// - For removed subtasks: clears their Parent Task
    fn link_subtasks(
        &self,
        task_id: Uuid,
        subtask_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Get all properties attached to an entity, with definitions, values, and options.
    fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<EntityPropertyInfo>, PropertiesErr>> + Send;

    /// Get a property value for an entity by property definition ID.
    /// Returns `None` if the property is not attached to the entity.
    fn get_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Option<PropertyValue>, PropertiesErr>> + Send;

    /// Get a system property value for an entity.
    /// Returns `None` if the property is not attached to the entity.
    fn get_system_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_key: SystemPropertyKey,
    ) -> impl Future<Output = Result<Option<PropertyValue>, PropertiesErr>> + Send;

    /// Set or update a property value for an entity, or attach a property without a value.
    /// Validates property options if the value contains select options.
    /// Requires edit access to the entity.
    fn set_entity_property(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Gets the owner of the entity and whether it's deleted
    fn get_owner_and_deleted(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(String, bool), PropertiesErr>> + Send;
}
