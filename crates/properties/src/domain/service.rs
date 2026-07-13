//! Service trait for properties.
//!
//! Access control is represented in the method types: every entity-scoped
//! method takes a [`ViewReceipt`] or [`EditReceipt`] proving the caller's
//! access, and owner-scoped methods take the caller's identity plus their
//! team-membership receipt. User-facing callers mint receipts through the
//! entity access service at the inbound edge; internal (machine) callers mint
//! via [`PropertiesAccessReceipt::dangerously_assert_internal`](super::model::PropertiesAccessReceipt::dangerously_assert_internal),
//! which makes unchecked paths explicit and greppable.

use std::collections::HashMap;

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
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
use models_properties::{EntityPropertyReference, EntityType};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::error::PropertiesErr;
use super::model::{
    EditReceipt, EntityPropertiesKey, EntityPropertyInfo, TagScope, TagSet, ViewReceipt,
};

/// The caller's team-membership proof, used to scope definition/option/tag
/// operations to the team the caller actually belongs to.
pub type TeamReceipt = EntityAccessReceipt<MemberTeamRole>;

/// The team id a team receipt proves membership of, if any.
pub fn team_id_from_receipt(team: Option<&TeamReceipt>) -> Option<Uuid> {
    team.and_then(|receipt| Uuid::parse_str(&receipt.entity().entity_id).ok())
}

/// Service trait for property operations.
pub trait PropertiesService: Send + Sync + 'static {
    /// Get all properties attached to an entity, with definitions, values, and
    /// options. Tag properties are restricted to the viewer's own and their
    /// teams' definitions (the viewer being the receipt's authenticated user).
    fn get_entity_properties(
        &self,
        access: &ViewReceipt,
    ) -> impl Future<Output = Result<Vec<EntityPropertyInfo>, PropertiesErr>> + Send;

    /// Get the tag sets visible to a caller — their personal set plus their
    /// teams' sets — with options attached.
    fn list_caller_tag_sets(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr>> + Send;

    /// Get a property value for an entity by property definition ID.
    /// Returns `None` if the property is not attached to the entity.
    fn get_property_value(
        &self,
        access: &ViewReceipt,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Option<PropertyValue>, PropertiesErr>> + Send;

    /// Get a system property value for an entity.
    /// Returns `None` if the property is not attached to the entity.
    fn get_system_property_value(
        &self,
        access: &ViewReceipt,
        property_key: SystemPropertyKey,
    ) -> impl Future<Output = Result<Option<PropertyValue>, PropertiesErr>> + Send;

    /// Set or update a property value for an entity, or attach a property without a value.
    /// Returns the canonical property assignment, definition, and persisted value.
    /// Validates property options if the value contains select options.
    /// Linking Parent Task / Subtasks additionally requires edit access to the
    /// referenced tasks.
    fn set_entity_property(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        value: Option<SetPropertyValue>,
    ) -> impl Future<Output = Result<EntityPropertyWithDefinition, PropertiesErr>> + Send;

    /// Add one option to a multi-select entity property value atomically.
    /// Attaches the property if needed and dedupes. Validates the option belongs
    /// to the (multi-select) property. Prefer this over `set_entity_property`
    /// for add/remove of a single option: it composes with concurrent changes
    /// instead of clobbering them.
    fn add_entity_property_option(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Remove one option from a multi-select entity property value atomically.
    /// A no-op if absent.
    fn remove_entity_property_option(
        &self,
        access: &EditReceipt,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// List property definitions owned by the given team and/or user, sorted by
    /// display name. Set `include_system` to true to also include system properties.
    /// When `for_entity_type` is provided, definitions that cannot be attached to
    /// that entity type are excluded.
    fn list_property_definitions(
        &self,
        team: Option<&TeamReceipt>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinition>, PropertiesErr>> + Send;

    /// Same as [`Self::list_property_definitions`], but including each definition's
    /// select options.
    fn list_property_definitions_with_options(
        &self,
        team: Option<&TeamReceipt>,
        user_id: Option<&MacroUserIdStr<'_>>,
        include_system: bool,
        for_entity_type: Option<EntityType>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, PropertiesErr>> + Send;

    /// Create a property definition owned by the caller (their user property,
    /// or their team's when the request has team scope). Fails with
    /// [`PropertiesErr::TeamMembershipRequired`] for team scope without a team.
    /// Validates the request and creates any select options atomically.
    fn create_property_definition(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
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
        team: Option<&TeamReceipt>,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Get all options for a property definition readable by the caller (for dropdowns).
    fn get_property_options(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> impl Future<Output = Result<Vec<PropertyOption>, PropertiesErr>> + Send;

    /// Add a new option to a select property owned by the caller.
    /// Validates the request against the property's data type, including the
    /// tag color rules.
    fn add_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        request: &AddPropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send;

    /// Update a property option in place (rename / recolor / reorder) on a
    /// property owned by the caller. The option id is preserved, so the change
    /// is reflected on every entity that references it.
    fn update_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        option_id: Uuid,
        request: &UpdatePropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send;

    /// Delete a property option on a property owned by the caller, stripping
    /// its id from every entity value that references it.
    fn delete_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// List the caller's tag sets: their personal set, plus their team's set
    /// when on a team. Pure read - a scope with no provisioned definition yet
    /// returns an empty set.
    fn list_tag_sets(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
    ) -> impl Future<Output = Result<Vec<TagSet>, PropertiesErr>> + Send;

    /// Provision (get-or-create) the caller's tag set for the scope and return
    /// it. Fails with [`PropertiesErr::TeamMembershipRequired`] for team scope
    /// without a team.
    fn ensure_tag_set(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        scope: TagScope,
    ) -> impl Future<Output = Result<TagSet, PropertiesErr>> + Send;

    /// Get an entity's stored properties with definitions, values, and options,
    /// sorted by display name. Personal tag properties of other users are
    /// filtered out. Does not include computed metadata properties
    /// (see [`Self::get_entity_metadata_properties`]).
    fn get_entity_properties_with_definitions(
        &self,
        access: &ViewReceipt,
    ) -> impl Future<Output = Result<Vec<EntityPropertyWithDefinition>, PropertiesErr>> + Send;

    /// Get an entity's read-only metadata properties, computed on-the-fly from
    /// the entity itself (name, owner, timestamps, ...).
    /// Returns `None` when the entity doesn't exist (or the id is malformed);
    /// entity types without metadata yield `Some(vec![])`.
    fn get_entity_metadata_properties(
        &self,
        access: &ViewReceipt,
    ) -> impl Future<Output = Result<Option<Vec<EntityPropertyWithDefinition>>, PropertiesErr>> + Send;

    /// Get properties for multiple entities, keyed by entity id and type.
    /// An empty `property_ids` fetches all properties for the given entities;
    /// otherwise only the requested definitions are returned. Personal tag
    /// properties of other users are filtered out per receipt.
    fn get_bulk_entity_properties(
        &self,
        access: &[ViewReceipt],
        property_ids: Vec<Uuid>,
    ) -> impl Future<
        Output = Result<
            HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>,
            PropertiesErr,
        >,
    > + Send;

    /// Delete all properties attached to an entity.
    fn delete_entity_properties(
        &self,
        access: &EditReceipt,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;

    /// Look up an entity property by its ID, returning the entity it is
    /// attached to so the caller can mint an edit receipt for
    /// [`Self::delete_entity_property`]. Returns `None` if it doesn't exist.
    fn lookup_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> impl Future<Output = Result<Option<EntityPropertyReference>, PropertiesErr>> + Send;

    /// Delete a single entity property by its ID. The receipt must be for the
    /// entity the property is attached to. Fails when the property doesn't
    /// exist, is required for the entity type, or the receipt is for a
    /// different entity.
    fn delete_entity_property(
        &self,
        access: &EditReceipt,
        entity_property_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send;
}
