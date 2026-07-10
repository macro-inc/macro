//! Port definitions (traits) for properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::document_metadata::DocumentMetadata;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::project_metadata::ProjectMetadata;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::service::thread_metadata::ThreadMetadata;
use models_properties::{DataType, EntityPropertyReference, EntityReference, EntityType};
use uuid::Uuid;

use super::model::{
    EditReceipt, EntityPropertiesKey, EntityPropertyInfo, PropertyDefinitionOwner,
    TaskAssignedNotification, UpdatePropertyOptionOutcome, ViewReceipt,
};

/// Repository trait for property operations.
///
/// This trait abstracts the database layer, allowing for different implementations
/// (e.g., PostgreSQL, mock for testing).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait PropertiesRepo: Send + Sync + 'static {
    type Err;

    /// Get a property definition by ID.
    /// Returns `None` if the property definition doesn't exist.
    fn get_property_definition(
        &self,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Option<PropertyDefinition>, Self::Err>> + Send;

    /// Get a property definition by ID with ownership validation.
    /// Returns `None` if the property doesn't exist, if the caller doesn't own it,
    /// or if it's a system property. The caller owns it when it is their user
    /// property, or a property of the team they belong to.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn get_property_definition_with_owner<'a>(
        &self,
        property_definition_id: Uuid,
        user_id: &MacroUserIdStr<'a>,
        team_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Option<PropertyDefinition>, Self::Err>> + Send;

    /// List property definitions owned by the given team and/or user.
    /// Set `include_system` to true to also include system properties.
    /// Returns definitions sorted by display name.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn list_property_definitions<'a>(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&'a MacroUserIdStr<'a>>,
        include_system: bool,
    ) -> impl Future<Output = Result<Vec<PropertyDefinition>, Self::Err>> + Send;

    /// List property definitions with their options, owned by the given team and/or user.
    /// Set `include_system` to true to also include system properties.
    /// Returns definitions sorted by display name.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn list_property_definitions_with_options<'a>(
        &self,
        team_id: Option<Uuid>,
        user_id: Option<&'a MacroUserIdStr<'a>>,
        include_system: bool,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Err>> + Send;

    /// Create a property definition, optionally with select options
    /// (atomically when options are provided).
    fn create_property_definition<'a>(
        &self,
        owner: PropertyDefinitionOwner<'a>,
        display_name: &str,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<EntityType>,
        options: Vec<PropertyOption>,
    ) -> impl Future<Output = Result<PropertyDefinition, Self::Err>> + Send;

    /// Delete a property definition and all associated data (cascades).
    /// A no-op if the definition doesn't exist.
    fn delete_property_definition(
        &self,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get a single property option by ID.
    /// Returns `None` if the option doesn't exist.
    fn get_property_option(
        &self,
        option_id: Uuid,
    ) -> impl Future<Output = Result<Option<PropertyOption>, Self::Err>> + Send;

    /// Get all options for a property definition, ordered for display.
    fn get_property_options(
        &self,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Vec<PropertyOption>, Self::Err>> + Send;

    /// Create a new property option.
    fn create_property_option(
        &self,
        property_definition_id: Uuid,
        display_order: i32,
        value: PropertyOptionValue,
        color: Option<String>,
    ) -> impl Future<Output = Result<PropertyOption, Self::Err>> + Send;

    /// Update a property option's value, color, and display order in place.
    /// The option id is preserved, so every entity referencing it reflects the
    /// change with no per-entity rewrite.
    fn update_property_option(
        &self,
        option_id: Uuid,
        value: PropertyOptionValue,
        color: Option<String>,
        display_order: i32,
    ) -> impl Future<Output = Result<UpdatePropertyOptionOutcome, Self::Err>> + Send;

    /// Delete a property option and strip its id from every entity value that
    /// references it, atomically. Returns `true` if the option was deleted,
    /// `false` if it didn't exist.
    fn delete_property_option(
        &self,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Get the single tag definition owned by the given owner, if it exists.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn get_tag_definition<'a>(
        &self,
        owner: PropertyDefinitionOwner<'a>,
    ) -> impl Future<Output = Result<Option<PropertyDefinition>, Self::Err>> + Send;

    /// Return the owner's tag definition, creating it on first use.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn get_or_create_tag_definition<'a>(
        &self,
        owner: PropertyDefinitionOwner<'a>,
    ) -> impl Future<Output = Result<PropertyDefinition, Self::Err>> + Send;

    /// Count how many of the provided option IDs exist for the property definition.
    fn count_valid_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Upsert an entity property value (insert or update).
    /// If the property doesn't exist, it will be created and attached to the entity.
    /// If it exists, the value will be updated.
    fn upsert_entity_property(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically add one option to a multi-select entity property value,
    /// attaching the property if needed. Re-adding a present option is a no-op.
    /// Composes with concurrent option changes without a lost update.
    fn add_entity_property_option(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically remove one option from a multi-select entity property value.
    /// A no-op if the property is unattached or the option is not present.
    fn remove_entity_property_option(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically link or unlink a task's parent (for Parent Task property).
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
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically set a task's subtasks (for Subtasks property).
    ///
    /// - Sets task's Subtasks to the new list
    /// - For added subtasks: sets their Parent Task = task
    /// - For removed subtasks: clears their Parent Task
    fn link_subtasks(
        &self,
        task_id: Uuid,
        subtask_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get a property value for a specific entity and property definition.
    /// Returns `None` if the property is not attached to the entity.
    fn get_entity_property_value(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
    ) -> impl Future<Output = Result<Option<PropertyValue>, Self::Err>> + Send;

    /// Get all properties attached to an entity, with definitions, values, and options.
    /// Tag properties are restricted to the viewer's own and their teams' definitions.
    /// Returns properties sorted by display name.
    fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        tag_viewer_user_id: &str,
    ) -> impl Future<Output = Result<Vec<EntityPropertyInfo>, Self::Err>> + Send;

    /// Get the tag definitions visible to a user — their own plus their teams' —
    /// with options attached.
    fn get_caller_tag_definitions(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Err>> + Send;

    /// Get all properties attached to multiple entities, keyed by entity id and type.
    /// Returns properties sorted by display name for each entity.
    fn get_entity_properties_batch(
        &self,
        entity_refs: Vec<EntityReference>,
    ) -> impl Future<
        Output = Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, Self::Err>,
    > + Send;

    /// Get the properties attached to multiple entities, filtered by property
    /// definition IDs, keyed by entity id and type. When `tag_viewer_user_id`
    /// is set, also returns TAG properties whose definition is owned by that
    /// user or their team.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn get_entity_properties_batch_filtered<'a>(
        &self,
        entity_refs: Vec<EntityReference>,
        property_ids: Vec<Uuid>,
        tag_viewer_user_id: Option<&'a MacroUserIdStr<'a>>,
    ) -> impl Future<
        Output = Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, Self::Err>,
    > + Send;

    /// Get an entity's properties with definitions, values, and options,
    /// sorted by display name.
    fn get_entity_properties_with_definitions(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<EntityPropertyWithDefinition>, Self::Err>> + Send;

    /// Look up an entity property by its ID.
    /// Returns the entity reference (for permissions) and definition ID
    /// (for required property checks), or `None` if it doesn't exist.
    fn lookup_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> impl Future<Output = Result<Option<EntityPropertyReference>, Self::Err>> + Send;

    /// Delete an entity property by its ID. A no-op if it doesn't exist.
    fn delete_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete all properties attached to an entity.
    fn delete_entity_properties(
        &self,
        entity_reference: &EntityReference,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get a document's metadata (name, owner, timestamps, project).
    /// Returns `None` if the document doesn't exist.
    /// Tasks are stored as documents, so this works for both.
    fn get_document_metadata(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Option<DocumentMetadata>, Self::Err>> + Send;

    /// Get an email thread's metadata (subject, timestamps, message count).
    /// Returns `None` if the thread doesn't exist.
    fn get_thread_metadata(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<ThreadMetadata>, Self::Err>> + Send;

    /// Get a project's metadata (name, owner, timestamps, parent).
    /// Returns `None` if the project doesn't exist or is deleted.
    fn get_project_metadata(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<Option<ProjectMetadata>, Self::Err>> + Send;
}

/// Permission service trait for entity access control.
///
/// This trait abstracts permission operations (receipt minting and granting),
/// allowing for different implementations (e.g., database-backed, mock for
/// testing). Minting is the single enforcement point: it encapsulates the
/// properties-specific access rules (Task shares Document permissions, the
/// thread-ownership fallback, and deleted entities being visible only to
/// their owner).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait PermissionService: Send + Sync + 'static {
    type Err;

    /// Mint a proof that the user (or the public, for `None`) has view access
    /// to the entity. The owner always has access; deleted entities are only
    /// visible to their owner. Errors if the caller has no access.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn mint_view_receipt<'a>(
        &self,
        user_id: Option<&'a MacroUserIdStr<'a>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<ViewReceipt, Self::Err>> + Send;

    /// Mint a proof that the user has edit (or owner) access to the entity.
    /// Errors if the caller has no edit access.
    // Explicit lifetime required by mockall's automock expansion.
    #[allow(clippy::needless_lifetimes)]
    fn mint_edit_receipt<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<EditReceipt, Self::Err>> + Send;

    /// Grant edit permissions to users for a task.
    /// This is used when task assignees are updated to ensure they can edit the task.
    fn grant_permissions_to_task<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
        task_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Notification service trait for sending notifications.
///
/// This trait abstracts notification operations, allowing for different implementations
/// (e.g., notification-service-backed, mock for testing). Adapters are expected to
/// enrich the domain-level notification (task name, sender profile picture) and fan
/// out delivery per recipient on a best-effort basis.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait NotificationService: Send + Sync + 'static {
    type Err;

    /// Notify the recipients that they were assigned to a task.
    fn send_task_assigned<'a>(
        &self,
        notification: TaskAssignedNotification<'a>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Port for keeping an entity's indexed properties in sync after a mutation.
///
/// Mirrors the per-domain `*SearchIndexer` ports (e.g. `CallSearchIndexer`):
/// the domain calls it on a write and an SQS-backed adapter in the composition
/// root publishes the upsert. `dyn`-compatible (boxed future) so it can be an
/// optional collaborator on the service without adding a generic parameter.
pub trait PropertySearchIndexer: Send + Sync + std::fmt::Debug {
    /// Enqueue an upsert of the entity's indexed properties. Best-effort —
    /// callers log and continue on error.
    fn enqueue_upsert(
        &self,
        entity_id: String,
        entity_type: EntityType,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send>>;
}
