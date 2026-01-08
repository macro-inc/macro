//! Port definitions (traits) for properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

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

    /// Get the name of a document.
    /// Returns `None` if the document doesn't exist or has no name.
    /// Tasks are stored as documents, so this works for both documents and tasks.
    fn get_document_name(
        &self,
        id: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Permission service trait for entity access control.
///
/// This trait abstracts permission operations (checking and granting), allowing for different implementations
/// (e.g., database-backed, mock for testing).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait PermissionService: Send + Sync + 'static {
    type Err;

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
/// (e.g., macro_notify-backed, mock for testing).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait NotificationService: Send + Sync + 'static {
    type Err;

    /// Send a notification message.
    /// Returns the notification ID if successful.
    fn send_notification(
        &self,
        message: model_notifications::NotificationQueueMessage,
    ) -> impl Future<Output = Result<uuid::Uuid, Self::Err>> + Send;
}
