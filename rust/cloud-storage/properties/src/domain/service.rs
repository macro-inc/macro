//! Service trait for properties.

use std::collections::HashMap;

use models_properties::api::CreatePropertyDefinitionRequest;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::error::PropertiesErr;
use super::model::{EntityPropertiesKey, EntityPropertyInfo, PropertyDefinitionOwner};

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

    /// Get all properties attached to multiple entities, keyed by entity id and type.
    fn get_entity_properties_batch(
        &self,
        entity_refs: Vec<EntityReference>,
    ) -> impl Future<
        Output = Result<
            HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>,
            PropertiesErr,
        >,
    > + Send;

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

    /// Add one option to a multi-select entity property value atomically.
    /// Attaches the property if needed and dedupes. Validates the option belongs
    /// to the (multi-select) property. Requires edit access. Prefer this over
    /// `set_entity_property` for add/remove of a single option: it composes with
    /// concurrent changes instead of clobbering them.
    fn add_entity_property_option(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Remove one option from a multi-select entity property value atomically.
    /// A no-op if absent. Requires edit access.
    fn remove_entity_property_option(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Gets the owner of the entity and whether it's deleted
    fn get_owner_and_deleted(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(String, bool), PropertiesErr>> + Send;

    /// List property definitions owned by the given team and/or user, sorted by
    /// display name. Set `include_system` to true to also include system properties.
    /// When `for_entity_type` is provided, definitions that cannot be attached to
    /// that entity type are excluded.
    fn list_property_definitions(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&str>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinition>, PropertiesErr>> + Send;

    /// Same as [`Self::list_property_definitions`], but including each definition's
    /// select options.
    fn list_property_definitions_with_options(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&str>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr>> + Send;

    /// Create a property definition owned by the given user or team.
    /// Validates the request and creates any select options atomically.
    fn create_property_definition(
        &self,
        owner: PropertyDefinitionOwner<'_>,
        request: &CreatePropertyDefinitionRequest,
    ) -> impl Future<Output = Result<PropertyDefinition, PropertiesErr>> + Send;

    /// Delete a property definition owned by the caller.
    ///
    /// Fails with [`PropertiesErr::NotFound`] if the definition doesn't exist or
    /// isn't owned by the caller (their user property or a property of their team),
    /// and with [`PropertiesErr::SystemPropertyNotModifiable`] for system properties.
    fn delete_property_definition(
        &self,
        property_definition_id: Uuid,
        user_id: &str,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;
}
