//! Task briefs from the document service and its live Markdown renderer.

use agent_session::domain::error::{AgentSessionError, Result};
use document_storage_service_client::DocumentStorageServiceClient;
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};
use messages::domain::service::MessageWrite;

use crate::domain::task_assignment::{TaskAssignmentContext, TaskBrief};

#[cfg(test)]
mod test;

/// Loads the current title and Markdown for an already-authorized task.
pub struct DssTaskAssignmentContext {
    documents: DocumentStorageServiceClient,
    lexical: LexicalClient,
}

impl DssTaskAssignmentContext {
    /// Compose the owning document service client and live Markdown renderer.
    pub fn new(documents: DocumentStorageServiceClient, lexical: LexicalClient) -> Self {
        Self { documents, lexical }
    }
}

impl TaskAssignmentContext for DssTaskAssignmentContext {
    async fn task_brief(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> Result<Option<TaskBrief>> {
        if access.entity().entity_type != EntityType::Document {
            return Err(AgentSessionError::Forbidden);
        }
        let document_id = &access.entity().entity_id;
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
        Ok(Some(TaskBrief {
            title: document.document_name,
            markdown,
        }))
    }
}
