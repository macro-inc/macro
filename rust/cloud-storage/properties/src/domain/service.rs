//! Service trait for properties.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::requests::SetPropertyValue;
use models_properties::api::{
    AddPropertyOptionRequest, CreatePropertyDefinitionRequest, UpdatePropertyOptionRequest,
};
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOption;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::error::PropertiesErr;
use super::model::{EntityPropertiesKey, EntityPropertyInfo, PropertyDefinitionOwner, TagSet};

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
    /// Tag properties are restricted to the viewer's own and their teams' definitions.
    fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        tag_viewer_user_id: &str,
    ) -> impl Future<Output = Result<Vec<EntityPropertyInfo>, PropertiesErr>> + Send;

    /// Get the tag sets visible to a caller — their personal set plus their
    /// teams' sets — with options attached.
    fn list_caller_tag_sets(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr>> + Send;

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
        user_id: &MacroUserIdStr<'_>,
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
        user_id: &MacroUserIdStr<'_>,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Remove one option from a multi-select entity property value atomically.
    /// A no-op if absent. Requires edit access.
    fn remove_entity_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
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
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinition>, PropertiesErr>> + Send;

    /// Same as [`Self::list_property_definitions`], but including each definition's
    /// select options.
    fn list_property_definitions_with_options(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&MacroUserIdStr<'_>>,
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
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Get all options for a property definition readable by the caller (for dropdowns).
    fn get_property_options(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<PropertyOption>, PropertiesErr>> + Send;

    /// Add a new option to a select property owned by the caller.
    /// Validates the request against the property's data type, including the
    /// tag color rules.
    fn add_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
        property_definition_id: Uuid,
        request: &AddPropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send;

    /// Update a property option in place (rename / recolor / reorder) on a
    /// property owned by the caller. The option id is preserved, so the change
    /// is reflected on every entity that references it.
    fn update_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
        property_definition_id: Uuid,
        option_id: Uuid,
        request: &UpdatePropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send;

    /// Delete a property option on a property owned by the caller, stripping
    /// its id from every entity value that references it.
    fn delete_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// List the caller's tag sets: their personal set, plus their team's set
    /// when on a team. Pure read - a scope with no provisioned definition yet
    /// returns an empty set.
    fn list_tag_sets(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Vec<TagSet>, PropertiesErr>> + Send;

    /// Provision (get-or-create) the owner's tag set and return it.
    fn ensure_tag_set(
        &self,
        owner: PropertyDefinitionOwner<'_>,
    ) -> impl Future<Output = Result<TagSet, PropertiesErr>> + Send;

    /// Get an entity's stored properties with definitions, values, and options,
    /// sorted by display name. Does not include computed metadata properties
    /// (see [`Self::get_entity_metadata_properties`]).
    fn get_entity_properties_with_definitions(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<EntityPropertyWithDefinition>, PropertiesErr>> + Send;

    /// Get an entity's read-only metadata properties, computed on-the-fly from
    /// the entity itself (name, owner, timestamps, ...).
    /// Returns `None` when the entity doesn't exist (or the id is malformed);
    /// entity types without metadata yield `Some(vec![])`.
    fn get_entity_metadata_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Option<Vec<EntityPropertyWithDefinition>>, PropertiesErr>> + Send;

    /// Get properties for multiple entities, keyed by entity id and type.
    /// An empty `property_ids` fetches all properties for the given entities;
    /// otherwise only the requested definitions are returned.
    fn get_bulk_entity_properties(
        &self,
        entity_refs: Vec<EntityReference>,
        property_ids: Vec<Uuid>,
    ) -> impl Future<
        Output = Result<
            HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>,
            PropertiesErr,
        >,
    > + Send;

    /// Delete all properties attached to an entity (internal operation, no
    /// permission checks).
    fn delete_entity_properties(
        &self,
        entity_reference: &EntityReference,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Delete a single entity property by its ID on behalf of a user.
    /// Fails when the property doesn't exist, is required for the entity type,
    /// or the user lacks edit access to the entity.
    fn delete_entity_property(
        &self,
        entity_property_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Check that a user has view access to an entity (any access level).
    /// For anonymous users (`None`), only allows publicly shared entities.
    fn check_entity_view_permission(
        &self,
        user_id: Option<&MacroUserIdStr<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Check that a user has edit access to an entity (Edit or Owner level).
    fn check_entity_edit_permission(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;
}
