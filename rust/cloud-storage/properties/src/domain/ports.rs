//! Port definitions (traits) for properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use uuid::Uuid;

use super::model::{EntityPropertiesKey, EntityPropertyInfo, TaskAssignedNotification};

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

    /// Count how many of the provided option IDs exist for the property definition.
    fn count_valid_property_options(
        &self,
        property_definition_id: Uuid,
        option_ids: &[Uuid],
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Atomically update a property value if the property is attached to the entity.
    /// No-op if the property is not attached.
    fn update_entity_property_value_if_exists(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

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
    /// Returns properties sorted by display name.
    fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<EntityPropertyInfo>, Self::Err>> + Send;

    /// Get all properties attached to multiple entities, keyed by entity id and type.
    /// Returns properties sorted by display name for each entity.
    fn get_entity_properties_batch(
        &self,
        entity_refs: Vec<EntityReference>,
    ) -> impl Future<
        Output = Result<HashMap<EntityPropertiesKey, Vec<EntityPropertyWithDefinition>>, Self::Err>,
    > + Send;
}

/// Permission service trait for entity access control.
///
/// This trait abstracts permission operations (checking and granting), allowing for different implementations
/// (e.g., database-backed, mock for testing).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait PermissionService: Send + Sync + 'static {
    type Err;

    /// Gets the owner of the entity and whether it's deleted
    fn get_owner_and_deleted(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(String, bool), Self::Err>> + Send;

    /// Check if a user has edit access to an entity.
    /// Returns an error if the user does not have edit or owner access.
    fn check_entity_edit_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

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
