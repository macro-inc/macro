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

    // Content reads need only the granted receipt and the configured exporter;
    // metadata and access services are separate capabilities of this adapter.
    async fn read_markdown(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, SkillError> {
        self.lexical
            .get_markdown(&receipt.entity().entity_id, MarkdownTarget::Internal)
            .await
            .map_err(SkillError::ReadFailed)
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

    async fn descriptions(
        &self,
        document_ids: &[Uuid],
    ) -> Result<std::collections::HashMap<Uuid, String>, SkillError> {
        let ids: Vec<String> = document_ids.iter().map(Uuid::to_string).collect();
        let descriptions = self
            .documents
            .skill_descriptions(&ids)
            .await
            .map_err(|error| SkillError::ListFailed(error.into()))?;
        Ok(descriptions
            .into_iter()
            .filter_map(|(id, description)| {
                Some((Uuid::parse_str(&id).ok()?, description.as_str().to_owned()))
            })
            .collect())
    }

    async fn markdown(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, SkillError> {
        self.read_markdown(receipt).await
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
    use lexical_client::test_utils::{FakeLexical, HELLO_DOCUMENT};

    #[tokio::test]
    async fn granted_skill_content_uses_the_selected_route_in_every_mode() {
        for mode in ["http", "in_process", "shadow"] {
            let backend = FakeLexical::new(
                HELLO_DOCUMENT,
                vec![(
                    "GET",
                    "/markdown/document-test?target=internal",
                    serde_json::json!({"data":"Hello"}),
                )],
            )
            .await;
            let reader = DocumentSkillReader::new(
                Arc::new(()),
                Arc::new(()),
                Arc::new(backend.client(&format!("markdown={mode}"))),
            );
            let receipt = EntityAccessReceipt::try_new_authenticated_user(
                MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                Entity {
                    entity_id: "document-test".into(),
                    entity_type: EntityType::Document,
                },
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                },
            )
            .unwrap();
            assert_eq!(reader.read_markdown(receipt).await.unwrap(), "Hello");
            assert_eq!(backend.requests().len(), usize::from(mode != "in_process"));
            assert_eq!(backend.raw_reads(), usize::from(mode != "http"));
        }
    }
}
