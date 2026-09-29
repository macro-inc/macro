//! Skill document capabilities backed by the owning document and access services.

use std::sync::Arc;

use documents::domain::ports::DocumentService;
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    model::{SkillDocumentMetadata, SkillError},
    ports::SkillReader,
};

/// Reads current document facts and markdown through existing services.
pub struct DocumentSkillReader<D, A> {
    documents: Arc<D>,
    access: Arc<A>,
    lexical: Arc<LexicalClient>,
}

impl<D, A> DocumentSkillReader<D, A> {
    /// Build the adapter from the services shared by document tools.
    pub fn new(documents: Arc<D>, access: Arc<A>, lexical: Arc<LexicalClient>) -> Self {
        Self {
            documents,
            access,
            lexical,
        }
    }
}

impl<D: DocumentService, A: EntityAccessService> SkillReader for DocumentSkillReader<D, A> {
    async fn authorize(
        &self,
        user_id: &MacroUserIdStr<'_>,
        document_id: Uuid,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, SkillError> {
        self.access
            .generate_entity_access_receipt(
                user_id,
                None,
                &document_id.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(SkillError::AccessDenied)
    }

    async fn metadata(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SkillDocumentMetadata, SkillError> {
        let document = self
            .documents
            .internal_get_basic_document(&receipt.entity().entity_id)
            .await
            .map_err(|error| SkillError::ReadFailed(error.into()))?;
        Ok(SkillDocumentMetadata {
            name: document.document_name,
            sub_type: document.sub_type,
            file_type: document.file_type,
            deleted: document.deleted_at.is_some(),
        })
    }

    async fn markdown(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, SkillError> {
        self.lexical
            .get_markdown(&receipt.entity().entity_id, MarkdownTarget::Internal)
            .await
            .map_err(SkillError::ReadFailed)
    }
}
