//! Service layer for system properties.

use std::collections::HashMap;

use models_properties::EntityType;
use uuid::Uuid;

#[cfg(test)]
mod test;

use crate::{
    StatusOption,
    domain::{
        model::{
            CrmRecordLink, EmailAttachmentInput, EmailAttachmentProperty, PropertyRow,
            SystemPropertyError, SystemPropertyKey,
        },
        port::SystemPropertiesRepository,
    },
};

/// Service trait for system property operations.
pub trait SystemPropertiesService: Clone + Send + Sync + 'static {
    /// Set email attachment properties for multiple entities.
    ///
    /// Only properties that are `Some` will be written.
    /// Existing values are left unchanged so a later import does not clobber
    /// Source, Sender, Recipients, or Subject.
    fn set_email_attachment_properties(
        &self,
        items: Vec<EmailAttachmentInput>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Associate an entity with CRM companies and contacts through the
    /// Companies and Contacts properties.
    ///
    /// Existing values are left unchanged, so automatic linking never
    /// overwrites associations a user already edited. Empty id lists write
    /// nothing.
    fn link_crm_records(
        &self,
        link: CrmRecordLink,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Set empty task system properties for multiple entities.
    ///
    /// Initializes all task-related system properties with null values.
    /// All properties are upserted in a single query.
    fn attach_task_properties(
        &self,
        entity_ids: Vec<String>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Attach the task-style initiative properties with null default values.
    /// Existing assignments are preserved so retries never clear edited values.
    fn attach_initiative_properties(
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

    /// Updates the task to have the provided status
    fn update_task_status(
        &self,
        task_id: &str,
        status: StatusOption,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;

    /// Tasks whose Project property names `project_id`, in id order. Callers
    /// authorize each task before showing it.
    fn project_task_ids(
        &self,
        project_id: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, SystemPropertyError>> + Send;

    /// The project each listed task belongs to, from its Project property.
    /// Tasks without a project are absent. Callers authorize both ends before
    /// showing it.
    fn task_projects(
        &self,
        task_ids: Vec<String>,
    ) -> impl Future<Output = Result<HashMap<String, Uuid>, SystemPropertyError>> + Send;
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
        items: Vec<EmailAttachmentInput<'_>>,
    ) -> Result<(), SystemPropertyError> {
        let rows: Vec<PropertyRow> = items
            .into_iter()
            .flat_map(|item| collect_email_property_rows(&item.entity_id, item.properties))
            .collect();

        self.repository.bulk_insert_properties_if_absent(rows).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn link_crm_records(&self, link: CrmRecordLink) -> Result<(), SystemPropertyError> {
        self.repository
            .bulk_insert_properties_if_absent(collect_crm_record_rows(link))
            .await
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

    #[tracing::instrument(skip(self, entity_ids))]
    async fn attach_initiative_properties(
        &self,
        entity_ids: Vec<String>,
    ) -> Result<(), SystemPropertyError> {
        let rows = entity_ids
            .iter()
            .flat_map(|entity_id| collect_required_property_rows(entity_id, EntityType::Initiative))
            .collect();

        self.repository.bulk_insert_properties_if_absent(rows).await
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

    #[tracing::instrument(skip(self))]
    async fn update_task_status(
        &self,
        task_id: &str,
        status: StatusOption,
    ) -> Result<(), SystemPropertyError> {
        self.repository.update_task_status(task_id, status).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn project_task_ids(&self, project_id: Uuid) -> Result<Vec<String>, SystemPropertyError> {
        self.repository.project_task_ids(project_id).await
    }

    #[tracing::instrument(err, skip(self, task_ids))]
    async fn task_projects(
        &self,
        task_ids: Vec<String>,
    ) -> Result<HashMap<String, Uuid>, SystemPropertyError> {
        if task_ids.is_empty() {
            return Ok(HashMap::new());
        }
        Ok(self
            .repository
            .task_projects(&task_ids)
            .await?
            .into_iter()
            // Writes store canonical ids; anything else names no project.
            .filter_map(|(task_id, project_id)| Some((task_id, project_id.parse().ok()?)))
            .collect())
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
            vec![user_id.as_ref().to_string()],
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
            user_ids
                .iter()
                .map(|s| s.as_ref().to_string())
                .collect::<Vec<_>>(),
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

/// Collect the Companies and Contacts rows for one entity, skipping empty lists.
fn collect_crm_record_rows(link: CrmRecordLink) -> Vec<PropertyRow> {
    let CrmRecordLink {
        entity_id,
        entity_type,
        company_ids,
        contact_ids,
    } = link;
    [
        (
            SystemPropertyKey::Companies,
            EntityType::Company,
            company_ids,
        ),
        (
            SystemPropertyKey::Contacts,
            EntityType::Contact,
            contact_ids,
        ),
    ]
    .into_iter()
    .filter(|(_, _, ids)| !ids.is_empty())
    .map(|(key, ref_type, ids)| {
        PropertyRow::entity_reference(
            entity_id.as_str(),
            entity_type,
            key.uuid(),
            ref_type,
            ids.iter().map(ToString::to_string).collect(),
            None,
        )
    })
    .collect()
}

/// Collect property rows for a single entity's task properties.
/// All task properties are initialized with null values.
/// Tasks are always applied to Task entities.
fn collect_task_property_rows(entity_id: &str) -> Vec<PropertyRow> {
    collect_required_property_rows(entity_id, EntityType::Task)
}

fn collect_required_property_rows(entity_id: &str, entity_type: EntityType) -> Vec<PropertyRow> {
    SystemPropertyKey::required_property_ids_for_entity(entity_type)
        .iter()
        .map(|property_id| PropertyRow::null_value(entity_id, entity_type, *property_id))
        .collect()
}
