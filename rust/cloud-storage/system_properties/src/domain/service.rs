//! Service layer for system properties.

use models_properties::EntityType;

use crate::domain::{
    model::{
        EmailAttachmentInput, EmailAttachmentProperty, PropertyRow, SystemPropertyError,
        SystemPropertyKey,
    },
    port::SystemPropertiesRepository,
};

/// Service trait for system property operations.
pub trait SystemPropertiesService: Clone + Send + Sync + 'static {
    /// Set email attachment properties for multiple entities.
    ///
    /// Only properties that are `Some` will be updated.
    /// All properties are upserted in a single query.
    fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Set empty task system properties for multiple entities.
    ///
    /// Initializes all task-related system properties with null values.
    /// All properties are upserted in a single query.
    fn attach_task_properties(
        &self,
        entity_ids: Vec<String>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Copy all task properties from one entity to another.
    ///
    /// Copies all task-related system properties from the source entity
    /// to the destination entity, overwriting any existing values.
    fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;
}

/// Implementation of SystemPropertiesService using a repository.
#[derive(Debug, Clone)]
pub struct SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    repository: R,
}

impl<R> SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    /// Create a new SystemPropertiesService.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
}

impl<R> SystemPropertiesService for SystemPropertiesServiceImpl<R>
where
    R: SystemPropertiesRepository,
{
    #[tracing::instrument(skip(self, items))]
    async fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> Result<(), SystemPropertyError> {
        let rows: Vec<PropertyRow> = items
            .into_iter()
            .flat_map(|item| collect_email_property_rows(&item.entity_id, item.properties))
            .collect();

        self.repository.bulk_upsert_properties(rows).await
    }

    #[tracing::instrument(skip(self, entity_ids))]
    async fn attach_task_properties(
        &self,
        entity_ids: Vec<String>,
    ) -> Result<(), SystemPropertyError> {
        let rows: Vec<PropertyRow> = entity_ids
            .iter()
            .flat_map(|entity_id| collect_task_property_rows(entity_id))
            .collect();

        self.repository.bulk_upsert_properties(rows).await
    }

    #[tracing::instrument(skip(self))]
    async fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> Result<(), SystemPropertyError> {
        self.repository
            .copy_task_properties(from_task_id, to_task_id)
            .await
    }
}

/// Collect property rows for a single entity's email attachment properties.
/// Email attachments are always applied to Document entities.
fn collect_email_property_rows(
    entity_id: &str,
    properties: EmailAttachmentProperty,
) -> Vec<PropertyRow> {
    let mut rows = Vec::new();
    let entity_type = EntityType::Document;

    // Source (single entity reference with optional specific_message_id)
    if let Some(source) = properties.source {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Source.uuid(),
            source.entity_type,
            vec![source.entity_id],
            source.specific_message_id,
        ));
    }

    // Companies (multi entity reference)
    if let Some(company_ids) = properties.companies {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Companies.uuid(),
            EntityType::Company,
            company_ids,
            None,
        ));
    }

    // Sender (single user reference)
    if let Some(user_id) = properties.sender {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Sender.uuid(),
            EntityType::User,
            vec![user_id],
            None,
        ));
    }

    // Recipients (multi user reference)
    if let Some(user_ids) = properties.recipients {
        rows.push(PropertyRow::entity_reference(
            entity_id,
            entity_type,
            SystemPropertyKey::Recipients.uuid(),
            EntityType::User,
            user_ids,
            None,
        ));
    }

    // Subject (string)
    if let Some(subject) = properties.subject {
        rows.push(PropertyRow::string_value(
            entity_id,
            entity_type,
            SystemPropertyKey::Subject.uuid(),
            subject,
        ));
    }

    rows
}

/// Collect property rows for a single entity's task properties.
/// All task properties are initialized with null values.
/// Tasks are always applied to Task entities.
fn collect_task_property_rows(entity_id: &str) -> Vec<PropertyRow> {
    let entity_type = EntityType::Task;

    vec![
        // Assignees
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::Assignees.uuid()),
        // Status
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::Status.uuid()),
        // Priority
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::Priority.uuid()),
        // Due Date
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::DueDate.uuid()),
        // Parent Task
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::ParentTask.uuid()),
        // Subtasks
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::Subtasks.uuid()),
        // Depends On
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::DependsOn.uuid()),
        // Effort
        PropertyRow::null_value(entity_id, entity_type, SystemPropertyKey::Effort.uuid()),
        // Story Points
        PropertyRow::null_value(
            entity_id,
            entity_type,
            SystemPropertyKey::StoryPoints.uuid(),
        ),
        // Relevant Documents
        PropertyRow::null_value(
            entity_id,
            entity_type,
            SystemPropertyKey::RelevantDocuments.uuid(),
        ),
    ]
}
