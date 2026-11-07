//! Task briefs from the document service and its live Markdown renderer.

use agent_session::domain::error::{AgentSessionError, Result};
use chrono::{DateTime, Utc};
use document_storage_service_client::DocumentStorageServiceClient;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};
use messages::domain::service::MessageWrite;
use models_properties::{
    EntityType as PropertyEntityType,
    service::{property_option::PropertyOptionValue, property_value::PropertyValue},
};
use properties::{EntityPropertyInfo, PropertiesErr, PropertiesService, ViewReceipt};
use system_properties::SystemPropertyKey;

use crate::domain::task_assignment::{TaskAssignmentContext, TaskBrief};

#[cfg(test)]
mod test;

/// The property domain's read of an authorized task's current properties.
#[cfg_attr(test, mockall::automock)]
pub trait TaskProperties: Send + Sync + 'static {
    /// Every property on the task, with option definitions to name select values.
    fn task_properties(
        &self,
        task: &ViewReceipt,
    ) -> impl Future<Output = std::result::Result<Vec<EntityPropertyInfo>, PropertiesErr>> + Send;
}

impl<P: PropertiesService> TaskProperties for P {
    async fn task_properties(
        &self,
        task: &ViewReceipt,
    ) -> std::result::Result<Vec<EntityPropertyInfo>, PropertiesErr> {
        self.get_entity_properties(task).await
    }
}

/// Loads the current title, Markdown, and properties for an already-authorized task.
pub struct DssTaskAssignmentContext<Properties> {
    documents: DocumentStorageServiceClient,
    lexical: LexicalClient,
    properties: Properties,
}

impl<Properties: TaskProperties> DssTaskAssignmentContext<Properties> {
    /// Compose the owning document service client, live Markdown renderer, and
    /// property service.
    pub fn new(
        documents: DocumentStorageServiceClient,
        lexical: LexicalClient,
        properties: Properties,
    ) -> Self {
        Self {
            documents,
            lexical,
            properties,
        }
    }
}

impl<Properties: TaskProperties> TaskAssignmentContext for DssTaskAssignmentContext<Properties> {
    async fn task_brief(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> Result<Option<TaskBrief>> {
        if access.entity().entity_type != EntityType::Document {
            return Err(AgentSessionError::Forbidden);
        }
        // Commenting on a task implies viewing it, so its properties are
        // read under the same access.
        let task: ViewReceipt = access
            .try_into_requirement::<ViewAccessLevel>()
            .map_err(|_| AgentSessionError::Forbidden)?;
        let document_id = &task.entity().entity_id;
        let Some(document) = self
            .documents
            .get_document_basic(document_id)
            .await
            .map_err(AgentSessionError::Unknown)?
        else {
            return Ok(None);
        };
        if document.document_id != *document_id {
            return Err(AgentSessionError::Forbidden);
        }
        if document.deleted_at.is_some() || document.sub_type != Some(DocumentSubType::Task) {
            return Ok(None);
        }
        // Extracted document text can lag a newly created or edited task. The
        // renderer reads the live content and includes it in the opening brief.
        let markdown = self
            .lexical
            .get_markdown(document_id, MarkdownTarget::External)
            .await
            .map_err(AgentSessionError::Unknown)?;
        let properties = self
            .properties
            .task_properties(&task)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        let property = |key: SystemPropertyKey| {
            properties
                .iter()
                .find(|property| property.property_definition_id == key.uuid())
        };
        Ok(Some(TaskBrief {
            title: document.document_name,
            markdown,
            status: property(SystemPropertyKey::Status).and_then(selected_option),
            priority: property(SystemPropertyKey::Priority).and_then(selected_option),
            due: property(SystemPropertyKey::DueDate).and_then(date),
            assignee_ids: property(SystemPropertyKey::Assignees)
                .map(users)
                .unwrap_or_default(),
            project: None,
        }))
    }
}

/// The selected option's label; single-select properties hold at most one.
fn selected_option(property: &EntityPropertyInfo) -> Option<String> {
    let Some(PropertyValue::SelectOption(ids)) = &property.value else {
        return None;
    };
    ids.iter()
        .find_map(|id| property.options.iter().find(|option| option.id == *id))
        .map(|option| match &option.value {
            PropertyOptionValue::String(label) => label.clone(),
            PropertyOptionValue::Number(number) => number.to_string(),
        })
}

fn date(property: &EntityPropertyInfo) -> Option<DateTime<Utc>> {
    match property.value {
        Some(PropertyValue::Date(date)) => Some(date),
        _ => None,
    }
}

/// User and bot ids; both are stored as user references.
fn users(property: &EntityPropertyInfo) -> Vec<String> {
    let Some(PropertyValue::EntityRef(references)) = &property.value else {
        return Vec::new();
    };
    references
        .iter()
        .filter(|reference| reference.entity_type == PropertyEntityType::User)
        .map(|reference| reference.entity_id.clone())
        .collect()
}
